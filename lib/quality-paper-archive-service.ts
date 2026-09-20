import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { reportRangeQuery } from './report-date-range';
import { beijingInput, QualityDataError, qualityText } from './quality-data';
import { positivePage, qualityInclude, serializeQuality } from './quality-data-service';
import type { PaperArchiveList, PaperArchiveRecord, PaperArchiveType } from './quality-paper-archive';

function archiveIndex(type: PaperArchiveType) {
  return Prisma.sql`WITH upload_events AS (
    SELECT record_id, created_at AS at, created_by_id AS actor_id, NULL::text AS actor_name FROM quality_data_attachments
    UNION ALL SELECT record_id, created_at, actor_id, actor_name FROM quality_data_revisions WHERE action = 'ATTACH'
  ), uploads AS (
    SELECT record_id, MIN(at) AS first_upload, MAX(at) AS last_upload,
      (array_agg(actor_id ORDER BY at DESC, actor_name DESC NULLS LAST))[1] AS uploader_id,
      (array_agg(actor_name ORDER BY at DESC, actor_name DESC NULLS LAST))[1] AS uploader_name
    FROM upload_events GROUP BY record_id
  ), records AS (
    SELECT r.*, u.first_upload, u.last_upload, u.uploader_id, u.uploader_name,
      to_char((r.inspected_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS start_day
    FROM quality_data_records r LEFT JOIN uploads u ON u.record_id = r.id WHERE r.type = ${type}
  )`;
}

/** Shared date archive for FIRST and PATROL, including immutable legacy records. */
export async function paperArchiveList(params: URLSearchParams, actorId: string, exporting = false): Promise<PaperArchiveList> {
  const type = params.get('type');
  if (type !== 'FIRST' && type !== 'PATROL') throw new QualityDataError('请选择首检报表或巡检报表');
  const state = params.get('status') || 'ALL';
  if (!['ALL', 'SUBMITTED', 'DRAFT'].includes(state)) throw new QualityDataError('归档状态无效');
  const page = positivePage(params.get('page'));
  const clauses: Prisma.Sql[] = [params.get('deleted') === '1' ? Prisma.sql`r.deleted_at IS NOT NULL` : Prisma.sql`r.deleted_at IS NULL`];
  const recordId = qualityText(params.get('recordId'), 120);
  if (recordId) clauses.push(Prisma.sql`r.id = ${recordId}`);
  const q = qualityText(params.get('q'), 160);
  if (q) {
    const pattern = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
    clauses.push(Prisma.sql`(r.search_text ILIKE ${pattern} OR EXISTS (SELECT 1 FROM upload_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.record_id = r.id AND (e.actor_name ILIKE ${pattern} OR u.display_name ILIKE ${pattern} OR u.username ILIKE ${pattern})))`);
  }
  const uploader = params.get('mine') === '1' ? actorId : qualityText(params.get('uploader'), 120);
  if (uploader) clauses.push(Prisma.sql`(EXISTS (SELECT 1 FROM upload_events e WHERE e.record_id = r.id AND e.actor_id = ${uploader}) OR (r.status = 'DRAFT' AND r.created_by_id = ${uploader}))`);
  const timeField = params.get('timeField') || 'inspection';
  if (!['inspection', 'upload'].includes(timeField)) throw new QualityDataError('日期类型无效');
  if (params.get('period') && params.get('period') !== 'all') {
    const period = params.get('period');
    if (!['today', 'week', 'month', 'custom'].includes(period!)) throw new QualityDataError('日期范围无效');
    const keys = period === 'custom' ? ['startDate', 'endDate'] : ['date'];
    for (const key of keys) {
      const day = params.get(key);
      if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0,10) !== day) throw new QualityDataError('日期范围无效');
    }
    if (period === 'custom' && params.get('startDate')! > params.get('endDate')!) throw new QualityDataError('日期范围无效');
    let range: ReturnType<typeof reportRangeQuery>;
    try { range = reportRangeQuery(params); } catch { throw new QualityDataError('日期范围无效，请检查开始和结束日期'); }
    if (timeField === 'upload') clauses.push(Prisma.sql`r.last_upload >= ${range.start} AND r.last_upload < ${range.end}`);
    else {
      const start = beijingInput(range.start).slice(0, 10), end = beijingInput(range.end).slice(0, 10);
      // Date-range overlap: a report covering several days is returned once.
      clauses.push(Prisma.sql`r.start_day < ${end} AND COALESCE(NULLIF(r.data->'paper'->>'dateEnd', ''), r.start_day) >= ${start}`);
    }
  }
  const where = Prisma.join(clauses, ' AND ');
  const stateWhere = state === 'ALL' ? Prisma.sql`TRUE` : Prisma.sql`r.status = ${state}`;
  const sorting = params.get('sort') === 'upload'
    ? Prisma.sql`COALESCE(r.last_upload, r.created_at) DESC, r.id DESC`
    : Prisma.sql`r.start_day DESC, COALESCE(r.last_upload, r.created_at) DESC, r.id DESC`;
  const index = archiveIndex(type);
  type Row = { id: string; first: Date | null; last: Date | null; uploaderId: string | null; uploaderName: string | null };
  const [counts, rows, uploaders] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ all: number; submitted: number; draft: number }>>`${index}
      SELECT COUNT(*)::int AS all, COUNT(*) FILTER (WHERE status = 'SUBMITTED')::int AS submitted,
        COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft FROM records r WHERE ${where}`,
    prisma.$queryRaw<Row[]>`${index} SELECT r.id, r.first_upload AS first, r.last_upload AS last,
      r.uploader_id AS "uploaderId", r.uploader_name AS "uploaderName"
      FROM records r WHERE ${where} AND ${stateWhere} ORDER BY ${sorting}
      LIMIT ${exporting ? 2001 : 20} OFFSET ${exporting ? 0 : (page - 1) * 20}`,
    prisma.$queryRaw<Array<{ id: string; name: string }>>`${index}
      SELECT e.actor_id AS id, COALESCE(MAX(NULLIF(u.display_name, '')), MAX(u.username), MAX(e.actor_name), MAX(r.created_by_name)) AS name
      FROM (SELECT actor_id, actor_name, record_id FROM upload_events UNION ALL SELECT created_by_id, created_by_name, id FROM records WHERE status = 'DRAFT') e
      JOIN records r ON r.id = e.record_id LEFT JOIN users u ON u.id = e.actor_id
      GROUP BY e.actor_id ORDER BY name, e.actor_id`,
  ]);
  const c = counts[0];
  const total = state === 'ALL' ? c.all : state === 'DRAFT' ? c.draft : c.submitted;
  if (exporting && total > 2000) throw new QualityDataError('报表超过 2000 份，请缩小日期范围后导出', 413);
  const records = await prisma.qualityDataRecord.findMany({ where: { id: { in: rows.map(row => row.id) } }, include: qualityInclude });
  const byId = new Map(records.map(record => [record.id, record]));
  const people = new Map(uploaders.map(person => [person.id, person.name]));
  const items: PaperArchiveRecord[] = rows.flatMap(row => {
    const source = byId.get(row.id);
    if (!source) return [];
    const record = serializeQuality(source);
    return [{ ...record, activity: {
      firstUploadedAt: row.first?.toISOString() || null, lastUploadedAt: row.last?.toISOString() || null,
      uploadedBy: row.uploaderName || (row.uploaderId ? people.get(row.uploaderId) : '') || (row.uploaderId === record.createdById ? record.createdByName : '历史上传人未记录'),
      changedAt: record.updatedAt,
    } }];
  });
  return { items, total, page, counts: c, uploaders };
}
