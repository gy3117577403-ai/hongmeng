import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { planWeekStartRange } from './drawing-plan-week';
import { reportRangeQuery } from './report-date-range';
import { QualityDataError, qualityText } from './quality-data';
import { positivePage, qualityInclude, qualityOrder, serializeQuality, orderInclude } from './quality-data-service';
import type { FirstOrders, FirstRecord, FirstRecords } from './quality-first-types';

// Attachment timestamps are upload facts. Draft creation and metadata edits must
// never be presented as uploads. ATTACH revisions also preserve re-upload events.
const index = Prisma.sql`WITH upload_events AS (
  SELECT record_id, created_at AS at, created_by_id AS actor_id, NULL::text AS actor_name FROM quality_data_attachments
  UNION ALL SELECT record_id, created_at, actor_id, actor_name FROM quality_data_revisions WHERE action = 'ATTACH'
), uploads AS (
  SELECT record_id, MIN(at) AS first_upload, MAX(at) AS last_upload,
    (array_agg(actor_id ORDER BY at DESC))[1] AS uploader_id,
    (array_agg(actor_name ORDER BY at DESC))[1] AS uploader_name
  FROM upload_events GROUP BY record_id
), records AS (
  SELECT r.*, u.first_upload, u.last_upload, u.uploader_id, u.uploader_name
  FROM quality_data_records r LEFT JOIN uploads u ON u.record_id = r.id WHERE r.type = 'FIRST'
), summaries AS (
  SELECT work_order_id, COUNT(*) FILTER (WHERE status = 'SUBMITTED')::int AS submitted_count,
    COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft_count,
    COUNT(DISTINCT inspection_step_id) FILTER (WHERE status = 'SUBMITTED')::int AS completed_steps,
    MAX(last_upload) AS last_upload
  FROM records WHERE deleted_at IS NULL GROUP BY work_order_id
)`;

function completion(params: URLSearchParams) {
  const value = params.get('completion') || 'ALL';
  if (!['ALL', 'DONE', 'TODO'].includes(value)) throw new QualityDataError('完成状态无效');
  return value;
}
function weekCondition(params: URLSearchParams) {
  const week = params.get('week');
  if (!week) return Prisma.sql`TRUE`;
  let range: ReturnType<typeof planWeekStartRange>;
  try { range = planWeekStartRange(week); } catch { throw new QualityDataError('计划周日期无效'); }
  return Prisma.sql`COALESCE(b.week_start_date, w.week_start_date) >= ${range.gte} AND COALESCE(b.week_start_date, w.week_start_date) < ${range.lt}`;
}
function recordCondition(params: URLSearchParams, actorId: string) {
  const conditions: Prisma.Sql[] = [params.get('deleted') === '1' ? Prisma.sql`r.deleted_at IS NOT NULL` : Prisma.sql`r.deleted_at IS NULL`];
  const q = qualityText(params.get('q'), 160);
  if (q) conditions.push(Prisma.sql`r.search_text ILIKE ${'%' + q.replace(/[\\%_]/g, '\\$&') + '%'}`);
  if (params.get('mine') === '1') conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM upload_events e WHERE e.record_id = r.id AND e.actor_id = ${actorId})`);
  const result = params.get('result');
  if (result) { if (!['PASS', 'FAIL', 'PENDING'].includes(result)) throw new QualityDataError('检验结果无效'); conditions.push(Prisma.sql`r.result = ${result}`); }
  if (params.get('draft') === '1') conditions.push(Prisma.sql`r.status = 'DRAFT'`);
  if (params.get('period') && params.get('period') !== 'all' && completion(params) !== 'TODO') {
    const range = reportRangeQuery(params);
    const field = params.get('timeField') === 'inspectedAt' ? Prisma.sql`r.inspected_at` : Prisma.sql`r.last_upload`;
    conditions.push(Prisma.sql`${field} >= ${range.start} AND ${field} < ${range.end}`);
  }
  return Prisma.join(conditions, ' AND ');
}
const joins = Prisma.sql`FROM work_orders w LEFT JOIN production_plan_batches b ON b.work_order_id = w.id LEFT JOIN summaries s ON s.work_order_id = w.id`;

export async function firstOrderList(params: URLSearchParams, actorId: string): Promise<FirstOrders> {
  const page = positivePage(params.get('page')), state = completion(params), q = qualityText(params.get('q'), 160);
  const clauses = [Prisma.sql`w.deleted_at IS NULL`, weekCondition(params)];
  const recordFiltered = params.get('mine') === '1' || params.get('result') || params.get('draft') === '1' || (params.get('period') && params.get('period') !== 'all' && state !== 'TODO');
  if (recordFiltered) clauses.push(Prisma.sql`EXISTS (SELECT 1 FROM records r WHERE r.work_order_id = w.id AND ${recordCondition(params, actorId)})`);
  else if (q) { const needle = '%' + q.replace(/[\\%_]/g, '\\$&') + '%'; clauses.push(Prisma.sql`(concat_ws(' ', w.code, w.business_code, w.product_name, w.specification, w.customer_name, w.source_order_no) ILIKE ${needle} OR EXISTS (SELECT 1 FROM records r WHERE r.work_order_id = w.id AND ${recordCondition(params, actorId)}))`); }
  const where = Prisma.join(clauses, ' AND ');
  const stateWhere = state === 'DONE' ? Prisma.sql`COALESCE(s.submitted_count, 0) > 0` : state === 'TODO' ? Prisma.sql`COALESCE(s.submitted_count, 0) = 0` : Prisma.sql`TRUE`;
  const [counts, rows] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ all: number; done: number }>>`${index} SELECT COUNT(*)::int AS all, COUNT(*) FILTER (WHERE COALESCE(s.submitted_count, 0) > 0)::int AS done ${joins} WHERE ${where}`,
    prisma.$queryRaw<Array<{ id: string; submittedCount: number; draftCount: number; completedSteps: number; lastUploadedAt: Date | null }>>`${index}
      SELECT w.id, COALESCE(s.submitted_count, 0) AS "submittedCount", COALESCE(s.draft_count, 0) AS "draftCount", COALESCE(s.completed_steps, 0) AS "completedSteps", s.last_upload AS "lastUploadedAt"
      ${joins} WHERE ${where} AND ${stateWhere} ORDER BY s.last_upload DESC NULLS LAST, w.created_at DESC, w.id DESC LIMIT 20 OFFSET ${(page - 1) * 20}`,
  ]);
  const orders = await prisma.workOrder.findMany({ where: { id: { in: rows.map(r => r.id) } }, include: orderInclude });
  const c = { all: counts[0].all, done: counts[0].done, todo: counts[0].all - counts[0].done };
  return { page, counts: c, total: state === 'ALL' ? c.all : state === 'DONE' ? c.done : c.todo,
    items: rows.map(row => ({ ...qualityOrder(orders.find(o => o.id === row.id)!), ...row, lastUploadedAt: row.lastUploadedAt?.toISOString() || null })) };
}

export async function firstRecordList(params: URLSearchParams, actorId: string, exporting = false): Promise<FirstRecords> {
  const page = positivePage(params.get('page')), state = completion(params);
  const conditions = [recordCondition(params, actorId), weekCondition(params)];
  if (params.get('workOrderId')) conditions.push(Prisma.sql`r.work_order_id = ${params.get('workOrderId')}`);
  if (params.get('step') === 'legacy') conditions.push(Prisma.sql`r.inspection_step_id IS NULL`);
  else if (params.get('step')) conditions.push(Prisma.sql`r.inspection_step_id = ${params.get('step')}`);
  if (params.get('recordId')) conditions.push(Prisma.sql`r.id = ${params.get('recordId')}`);
  // A selected record remains visible after saving under TODO. Explicitly pinned
  // record lookups bypass only the completion queue, never authorization.
  if (!params.get('recordId')) {
    if (state === 'DONE') conditions.push(Prisma.sql`COALESCE(s.submitted_count, 0) > 0`);
    if (state === 'TODO') conditions.push(Prisma.sql`COALESCE(s.submitted_count, 0) = 0`);
  }
  const from = Prisma.sql`FROM records r LEFT JOIN work_orders w ON w.id = r.work_order_id LEFT JOIN production_plan_batches b ON b.work_order_id = w.id LEFT JOIN summaries s ON s.work_order_id = r.work_order_id WHERE ${Prisma.join(conditions, ' AND ')}`;
  type Row = { id: string; first: Date | null; last: Date | null; uploaderId: string | null; uploaderName: string | null; changed: Date };
  const [totals, rows] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ total: number }>>`${index} SELECT COUNT(*)::int AS total ${from}`,
    prisma.$queryRaw<Row[]>`${index} SELECT r.id, r.first_upload AS first, r.last_upload AS last, r.uploader_id AS "uploaderId", r.uploader_name AS "uploaderName", r.updated_at AS changed ${from}
      ORDER BY COALESCE(r.last_upload, r.submitted_at, r.created_at) DESC, r.id DESC LIMIT ${exporting ? 2001 : 20} OFFSET ${exporting ? 0 : (page - 1) * 20}`,
  ]);
  if (exporting && totals[0].total > 2000) throw new QualityDataError('记录超过 2000 份，请缩小筛选范围后导出');
  const [records, users] = await Promise.all([
    prisma.qualityDataRecord.findMany({ where: { id: { in: rows.map(r => r.id) } }, include: qualityInclude }),
    prisma.user.findMany({ where: { id: { in: rows.flatMap(r => r.uploaderId ? [r.uploaderId] : []) } }, select: { id: true, displayName: true, username: true } }),
  ]);
  const items: FirstRecord[] = rows.map(row => { const record = serializeQuality(records.find(r => r.id === row.id)!); const uploader = users.find(u => u.id === row.uploaderId); return { ...record, activity: {
    firstUploadedAt: row.first?.toISOString() || null, lastUploadedAt: row.last?.toISOString() || null,
    uploadedBy: row.uploaderName || uploader?.displayName || uploader?.username || (row.uploaderId === record.createdById ? record.createdByName : '历史上传人未记录'), changedAt: row.changed.toISOString(),
  } }; });
  return { items, total: totals[0].total, page };
}
