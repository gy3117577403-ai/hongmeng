import { parseProcessQualityReport } from './process-quality-report';
import { resolveQualityResponsibility } from './process-quality-personnel';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { reportRangeQuery } from '@/lib/report-date-range';
import { bindQualityTeam } from './quality-data-options';
import {
  assertQualityEdit, assertQualitySubmission, beijingInput, qualityDate, qualityForm, qualityResult, qualityText, qualityType,
  QualityDataError, type QualityActor, type QualityFormData, type QualityOrder, type QualityRecord,
} from '@/lib/quality-data';

const orderInclude = Prisma.validator<Prisma.WorkOrderInclude>()({
  productionPlanBatch: { include: { planOrder: true } },
  processRoute: { select: { steps: { where: { retiredAt: null }, select: { id: true, processName: true, position: true, routeId: true }, orderBy: { position: 'asc' } } } },
});
type OrderSource = Prisma.WorkOrderGetPayload<{ include: typeof orderInclude }>;
const attachmentsInclude = { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }, { id: 'asc' as const }] };
export const qualityInclude = { attachments: attachmentsInclude };
type RecordSource = Prisma.QualityDataRecordGetPayload<{ include: typeof qualityInclude }>;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export function qualityOrder(order: OrderSource, parentBatch?: OrderSource['productionPlanBatch']): QualityOrder {
  const batch = order.productionPlanBatch || parentBatch;
  return {
    id: order.id, code: order.code, businessCode: order.businessCode, sourceOrderNo: batch?.planOrder.sourceOrderNo || order.sourceOrderNo,
    customerName: batch?.planOrder.customerName || order.customerName, productName: order.productName, specification: order.specification,
    orderDate: (batch?.planOrder.orderDate || order.orderDate)?.toISOString() || null,
    stage: order.stage, deletedAt: order.deletedAt?.toISOString() || null,
    quantity: order.productionTargetQty ?? batch?.quantity ?? null,
    planOrderId: batch?.planOrderId || null, batchId: batch?.id || null, batchNo: batch?.batchNo ?? null,
    sourceLineNo: batch?.planOrder.sourceLineNo ?? null, rootWorkOrderId: order.rootWorkOrderId, parentWorkOrderId: order.parentWorkOrderId,
    steps: order.processRoute?.steps.map(step => ({ id: step.id, name: step.processName, position: step.position, routeId: step.routeId })) || [],
  };
}
export async function readQualityOrder(tx: Prisma.TransactionClient, id: string, allowDeleted = false) {
  const order = await tx.workOrder.findFirst({ where: { id, ...(allowDeleted ? {} : { deletedAt: null }) }, include: orderInclude });
  if (!order) throw new QualityDataError('工单不存在或已删除', 404);
  const root = !order.productionPlanBatch && order.rootWorkOrderId
    ? await tx.workOrder.findUnique({ where: { id: order.rootWorkOrderId }, include: orderInclude }) : null;
  return qualityOrder(order, root?.productionPlanBatch);
}
export async function qualityOrderOptions(params: URLSearchParams) {
  const q = qualityText(params.get('q'), 160);
  const page = positivePage(params.get('page'));
  const where: Prisma.WorkOrderWhereInput = {
    deletedAt: null,
    ...(q ? { OR: ['code', 'businessCode', 'sourceOrderNo', 'productName', 'specification', 'customerName'].map(key => ({ [key]: { contains: q, mode: 'insensitive' } })) } : {}),
  };
  const [total, orders] = await prisma.$transaction([
    prisma.workOrder.count({ where }),
    prisma.workOrder.findMany({ where, include: orderInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 20, take: 20 }),
  ]);
  return { total, page, items: orders.map(order => qualityOrder(order)) };
}
export async function qualityQrOrder(code: string) {
  const ticket = await prisma.workOrderQrTicket.findUnique({ where: { publicCode: code }, select: { workOrderId: true, status: true } });
  if (!ticket || ticket.status !== 'ACTIVE') throw new QualityDataError('二维码不存在或已经停用', 404);
  // Inspection is independent of production reporting's started/completed gate.
  return readQualityOrder(prisma, ticket.workOrderId);
}
export function serializeQuality(record: RecordSource): QualityRecord {
  const { searchText: _search, idempotencyKey: _key, requestHash: _hash, updatedById: _updated, deletedById: _deleted, ...rest } = record;
  return json({
    ...rest,
    attachments: record.attachments.map(({ objectKey: _objectKey, createdById: _actor, recordId: _recordId, ...file }) => file),
  }) as unknown as QualityRecord;
}
export async function loadQualityRecord(id: string) {
  const record = await prisma.qualityDataRecord.findUnique({
    where: { id }, include: qualityInclude,
  });
  if (!record) throw new QualityDataError('质量记录不存在', 404);
  return serializeQuality(record);
}
export async function qualityHistory(id: string, page: number) {
  const [total, items] = await prisma.$transaction([
    prisma.qualityDataRevision.count({ where: { recordId: id } }),
    prisma.qualityDataRevision.findMany({ where: { recordId: id }, orderBy: { version: 'desc' }, skip: (page - 1) * 20, take: 20,
      select: { version: true, action: true, reason: true, actorName: true, createdAt: true } }),
  ]);
  return { total, items, page };
}
export async function qualityHistoricalRecord(id: string, version: number) {
  const revision = await prisma.qualityDataRevision.findUnique({ where: { recordId_version: { recordId: id, version } } });
  if (!revision) throw new QualityDataError('历史版本不存在', 404);
  return revision.snapshot as unknown as QualityRecord;
}
export function positivePage(value: string | null) {
  const n = Number(value || 1);
  if (!Number.isInteger(n) || n < 1 || n > 100000) throw new QualityDataError('页码无效');
  return n;
}
export function qualityWhere(params: URLSearchParams): Prisma.QualityDataRecordWhereInput {
  const where: Prisma.QualityDataRecordWhereInput = { deletedAt: params.get('deleted') === '1' ? { not: null } : null };
  if (params.get('period') !== 'all') {
    const range = reportRangeQuery(params);
    const date = { gte: range.start, lt: range.end };
    if (params.get('timeField') === 'createdAt') where.createdAt = date;
    else where.inspectedAt = date;
  }
  if (params.get('source') === 'report') where.sourceCompletionId = { not: null };
  if (params.get('source') === 'manual') { where.sourceCompletionId = null; where.supersedesId = null; }
  if (params.get('source') === 'retest') where.supersedesId = { not: null };
  if (params.get('inspectionScope') === 'first') where.supersedesId = null;
  if (params.get('responsibility') === 'PENDING') where.responsibilityStatus = 'PENDING';
  if (params.get('workOrderId')) where.workOrderId = qualityText(params.get('workOrderId'), 120);
  if (params.get('inspectionStepId')) where.inspectionStepId = qualityText(params.get('inspectionStepId'), 120);
  if (params.get('unassignedStep') === '1') where.inspectionStepId = null;
  if (params.get('scan') === '1') where.type = { not: 'PATROL' };
  if (params.get('type')) where.type = qualityType(params.get('type'));
  if (params.get('scan') === '1' && params.get('type') === 'PATROL') throw new QualityDataError('巡检报表请在质量数据中按日期上传');
  if (params.get('status')) {
    if (!['DRAFT','SUBMITTED'].includes(params.get('status')!)) throw new QualityDataError('记录状态无效');
    where.status = params.get('status')!;
  }
  if (params.get('result')) {
    if (!['PASS','FAIL','PENDING'].includes(params.get('result')!)) throw new QualityDataError('检验结论无效');
    where.result = params.get('result')!;
  }
  if (params.get('reviewStatus')) {
    if (!['UNREVIEWED','APPROVED','RETURNED'].includes(params.get('reviewStatus')!)) throw new QualityDataError('复核状态无效');
    where.reviewStatus = params.get('reviewStatus')!;
  }
  const q = qualityText(params.get('q'), 160);
  if (q) where.searchText = { contains: q, mode: 'insensitive' };
  return where;
}
export async function listQualityRecords(params: URLSearchParams) {
  const where = qualityWhere(params), page = positivePage(params.get('page'));
  const [total, items, counts] = await prisma.$transaction([
    prisma.qualityDataRecord.count({ where }),
    prisma.qualityDataRecord.findMany({ where, include: qualityInclude, orderBy: [{ inspectedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 20, take: 20 }),
    prisma.qualityDataRecord.groupBy({ by: ['result', 'status'], where: { ...where, status: undefined, result: undefined }, _count: true, orderBy: { result: 'asc' } }),
  ]);
  return { total, page, items: items.map(serializeQuality), counts };
}
function searchText(order: QualityOrder, data: QualityFormData, title: string, actor: string, files: string[] = []) {
  return [title, actor, JSON.stringify(order), JSON.stringify(data), ...files].join(' ');
}
export async function qualityFirstOverview(workOrderId: string) {
  const order = await readQualityOrder(prisma, workOrderId);
  const where = { workOrderId, type: 'FIRST', deletedAt: null };
  const [latest, counts, identities] = await Promise.all([
    prisma.qualityDataRecord.findMany({ where: { ...where, status: 'SUBMITTED' }, distinct: ['inspectionStepId'], orderBy: [{ inspectedAt: 'desc' }, { createdAt: 'desc' }], select: { inspectionStepId: true, inspectionStepSnapshot: true, result: true } }),
    prisma.qualityDataRecord.groupBy({ by: ['inspectionStepId'], where, _count: true }),
    prisma.qualityDataRecord.findMany({ where, distinct: ['inspectionStepId'], orderBy: { createdAt: 'desc' }, select: { inspectionStepId: true, inspectionStepSnapshot: true } }),
  ]);
  const current = new Set(order.steps.map(step => step.id));
  const historical = identities.filter(record => record.inspectionStepId && !current.has(record.inspectionStepId) && record.inspectionStepSnapshot)
    .map(record => ({ ...(record.inspectionStepSnapshot as { id: string; name: string; position: number; routeId: string }), retired: true }));
  const steps = [...order.steps.map(step => ({ ...step, retired: false })), ...historical].map(step => ({ ...step, result: latest.find(record => record.inspectionStepId === step.id)?.result || null, count: counts.find(record => record.inspectionStepId === step.id)?._count || 0 }));
  return { order, steps, unassignedCount: counts.find(record => record.inspectionStepId === null)?._count || 0 };
}
function patrolContext(): QualityOrder {
  return { id: '', code: '', businessCode: null, sourceOrderNo: null, customerName: null, productName: '巡检报表', specification: null,
    orderDate: null, stage: 'archive', quantity: null, planOrderId: null, batchId: null, batchNo: null, sourceLineNo: null,
    rootWorkOrderId: null, parentWorkOrderId: null, steps: [] };
}
async function resolveInspectionStep(tx: Prisma.TransactionClient, workOrderId: string, stepId: string) {
  if (!stepId) throw new QualityDataError('请选择本次首件检验的具体工序');
  const step = await tx.workOrderProcessStep.findFirst({ where: { id: stepId, retiredAt: null, route: { workOrderId } }, select: { id: true, processName: true, position: true, routeId: true } });
  if (!step) throw new QualityDataError('所选工序不属于当前工单，或已退役，请刷新后重新选择', 409);
  return { id: step.id, name: step.processName, position: step.position, routeId: step.routeId };
}
function assertPaperResult(type: string, data: QualityFormData) {
  if (type === 'FIRST' && data.paper && !data.paper.result) throw new QualityDataError('请选择本次首件检验结果');
}
/** Aggregate all matching records in SQL; dates are Shanghai inspection dates, not upload dates. */
export async function qualityArchiveDays(params: URLSearchParams) {
  const range = reportRangeQuery(params);
  const q = qualityText(params.get('q'), 160), deleted = params.get('deleted') === '1';
  return prisma.$queryRaw<Array<{ date: string; count: number }>>`
    SELECT to_char((inspected_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS date, count(*)::int AS count
    FROM quality_data_records
    WHERE type = 'PATROL' AND inspected_at >= ${range.start} AND inspected_at < ${range.end}
      AND (CASE WHEN ${deleted} THEN deleted_at IS NOT NULL ELSE deleted_at IS NULL END)
      AND (${q} = '' OR position(lower(${q}) in lower(search_text)) > 0)
    GROUP BY 1 ORDER BY 1 DESC`;
}
export async function snapshotQuality(tx: Prisma.TransactionClient, id: string, actor: QualityActor, action: string, reason: string) {
  const record = await tx.qualityDataRecord.findUniqueOrThrow({ where: { id }, include: qualityInclude });
  await tx.qualityDataRevision.create({ data: {
    recordId: id, version: record.version, actorId: actor.id, actorName: actor.name, action, reason,
    snapshot: json(serializeQuality(record)),
  } });
  return serializeQuality(record);
}
export async function lockQuality(tx: Prisma.TransactionClient, id: string, version: unknown) {
  if (!Number.isInteger(version) || Number(version) < 1) throw new QualityDataError('缺少记录版本，请刷新后重试', 409);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'quality-data:' + id}))`;
  const record = await tx.qualityDataRecord.findUnique({ where: { id }, include: qualityInclude });
  if (!record) throw new QualityDataError('质量记录不存在', 404);
  if (record.version !== version) throw new QualityDataError('记录已被更新，请刷新后重新操作', 409, 'QUALITY_DATA_VERSION_CONFLICT');
  return record;
}
export async function createQualityRecord(actor: QualityActor, body: Record<string, unknown>) {
  const type = qualityType(body.type), data = qualityForm(body.data), inspectedAt = qualityDate(body.inspectedAt);
  const title = qualityText(body.title, 160);
  if (!title) throw new QualityDataError('请填写记录标题');
  const workOrderId = qualityText(body.workOrderId, 120) || null, sourceQrCode = qualityText(body.sourceQrCode, 120) || null;
  const inspectionStepId = qualityText(body.inspectionStepId, 120) || null;
  if (type === 'PATROL' && (sourceQrCode || workOrderId)) throw new QualityDataError('巡检报表按日期归档，请从质量数据入口上传，无需关联单一工单');
  if (type !== 'FIRST' && inspectionStepId) throw new QualityDataError('首件检验工序关联不适用于此类型');
  if (type !== 'PATROL' && !workOrderId) throw new QualityDataError('请选择本次检验工单');
  const supersedesId = qualityText(body.supersedesId, 120) || null;
  const idempotencyKey = qualityText(body.idempotencyKey, 100);
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(idempotencyKey)) throw new QualityDataError('提交标识无效，请重新打开表单');
  const status = body.status === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT';
  if (status === 'SUBMITTED') { assertPaperResult(type, data); assertQualitySubmission(data, 0); }
  const requestHash = createHash('sha256').update(JSON.stringify({ type, data, inspectedAt, title, workOrderId, inspectionStepId, sourceQrCode, supersedesId, status })).digest('hex');
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'quality-data-create:' + actor.id + ':' + idempotencyKey}))`;
    const previous = await tx.qualityDataRecord.findUnique({ where: { createdById_idempotencyKey: { createdById: actor.id, idempotencyKey } }, include: qualityInclude });
    if (previous) {
      if (previous.requestHash !== requestHash) throw new QualityDataError('同一提交标识的内容发生变化，请刷新记录后继续编辑', 409);
      return serializeQuality(previous);
    }
    const orderSnapshot = workOrderId ? await readQualityOrder(tx, workOrderId) : patrolContext();
    const inspectionStepSnapshot = type === 'FIRST' ? await resolveInspectionStep(tx, workOrderId!, inspectionStepId || '') : null;
    if (inspectionStepSnapshot) data.context.processName = inspectionStepSnapshot.name;
    await bindQualityTeam(tx, data);
    if (sourceQrCode) {
      const ticket = await tx.workOrderQrTicket.findUnique({ where: { publicCode: sourceQrCode } });
      if (!ticket || ticket.status !== 'ACTIVE' || ticket.workOrderId !== workOrderId) throw new QualityDataError('二维码与当前工单不匹配或已停用', 409);
    }
    if (supersedesId) {
      const original = await tx.qualityDataRecord.findFirst({ where: { id: supersedesId, workOrderId, type, status: 'SUBMITTED', deletedAt: null } });
      if (!original) throw new QualityDataError('复检必须关联同一工单、同一类型的有效已提交记录', 409);
      if (type === 'FIRST' && original.inspectionStepId !== inspectionStepId) throw new QualityDataError('首件复检须关联同一工序', 409);
    }
    const id = randomUUID();
    const record = await tx.qualityDataRecord.create({ data: {
      id, code: 'QD-' + beijingInput().slice(0,10).replaceAll('-', '') + '-' + id.slice(0,8).toUpperCase(),
      workOrderId, inspectionStepId, ...(inspectionStepSnapshot ? { inspectionStepSnapshot: json(inspectionStepSnapshot) } : {}), type, data: json(data), orderSnapshot: json(orderSnapshot), title, inspectedAt, status,
      result: qualityResult(data), searchText: searchText(orderSnapshot, data, title, actor.name),
      createdById: actor.id, createdByName: actor.name, updatedById: actor.id,
      sourceQrCode, supersedesId, idempotencyKey, requestHash, submittedAt: status === 'SUBMITTED' ? new Date() : null,
    } });
    return snapshotQuality(tx, record.id, actor, status === 'SUBMITTED' ? 'SUBMIT' : 'CREATE', '新建质量记录');
  });
}
function mutationReason(body: Record<string, unknown>, required: boolean) {
  const reason = qualityText(body.reason, 1000);
  if (required && !reason) throw new QualityDataError('请填写本次操作原因');
  return reason;
}
export async function mutateQualityRecord(id: string, actor: QualityActor, body: Record<string, unknown>) {
  return prisma.$transaction(async tx => {
    const current = await lockQuality(tx, id, body.version);
    const action = String(body.action || 'SAVE');
    if (current.sourceCompletionId && ['DELETE', 'RESTORE', 'SAVE', 'SUBMIT'].includes(action)) throw new QualityDataError('此记录来自工序报工，数量更正或作废请从原报工处理；责任说明可单独补充', 409, 'QUALITY_SOURCE_REPORT_LOCKED');
    const reason = mutationReason(body, current.status === 'SUBMITTED' || ['DELETE','RESTORE','REVIEW','RETURN'].includes(action));
    let update: Prisma.QualityDataRecordUpdateInput = { version: { increment: 1 }, updatedById: actor.id };
    if (action === 'UPDATE_REPORT_DETAILS') {
      assertQualityEdit(actor, current);
      if (!current.sourceCompletionId) throw new QualityDataError('此操作仅用于报工检验记录');
      const report = parseProcessQualityReport(body.qualityReport);
      if (!report || report.evidenceIds.length) throw new QualityDataError('请填写责任与说明；照片请使用附件上传');
      const data = current.data as unknown as QualityFormData;
      const responsibility = await resolveQualityResponsibility(tx, report, Number(data.context.defectQty || 0));
      const snapshot = current.reportSnapshot as Record<string, unknown>;
      update = { ...update, responsibility: json(responsibility), responsibilityStatus: Number(data.context.defectQty || 0) > 0 ? responsibility.status : 'NONE',
        data: json({ ...data, summary: [report.issue, report.note].filter(Boolean).join('；') }),
        reportSnapshot: json({ ...snapshot, issue: report.issue, note: report.note }),
        searchText: searchText(current.orderSnapshot as unknown as QualityOrder, data, current.title, current.createdByName) + ' ' + JSON.stringify(responsibility) + ' ' + report.issue + ' ' + report.note,
        ...qualityRevisionReset(),
      };
    } else if (action === 'DELETE') {
      if (current.deletedAt) throw new QualityDataError('记录已经在回收站', 409);
      if (!actor.canManage && (current.createdById !== actor.id || current.status !== 'DRAFT')) throw new QualityDataError('已提交记录须由质量人员或管理员作废', 403);
      update = { ...update, deletedAt: new Date(), deleteReason: reason, deletedById: actor.id };
    } else if (action === 'RESTORE') {
      if (!actor.canManage) throw new QualityDataError('只有质量人员和管理员可以恢复记录', 403);
      if (!current.deletedAt) throw new QualityDataError('记录不在回收站', 409);
      update = { ...update, deletedAt: null, deleteReason: null, deletedById: null };
    } else if (action === 'REVIEW' || action === 'RETURN') {
      if (!actor.canReview) throw new QualityDataError('当前账号没有质量复核权限', 403);
      if (current.deletedAt || current.status !== 'SUBMITTED') throw new QualityDataError('只能复核有效的已提交记录', 409);
      update = { ...update, reviewStatus: action === 'REVIEW' ? 'APPROVED' : 'RETURNED', reviewedAt: new Date(), reviewedByName: actor.name, reviewNote: reason };
    } else if (action === 'REORDER_ATTACHMENTS') {
      assertQualityEdit(actor, current);
      const ids = body.attachmentIds;
      const active = current.attachments.filter(file => !file.deletedAt);
      if (!Array.isArray(ids) || ids.length !== active.length || new Set(ids).size !== ids.length || ids.some(id => !active.some(file => file.id === id))) throw new QualityDataError('附件顺序已变化，请刷新后重试', 409);
      for (const [sortOrder, fileId] of ids.entries()) await tx.qualityDataAttachment.update({ where: { id: String(fileId) }, data: { sortOrder } });
    } else if (action === 'SAVE' || action === 'SUBMIT') {
      assertQualityEdit(actor, current);
      const data = qualityForm(body.data), inspectedAt = qualityDate(body.inspectedAt), title = qualityText(body.title, 160);
      await bindQualityTeam(tx, data, current.data as unknown as QualityFormData);
      if (!title) throw new QualityDataError('请填写记录标题');
      const status = action === 'SUBMIT' || current.status === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT';
      if (current.type === 'FIRST') {
        const requestedStep = qualityText(body.inspectionStepId, 120);
        if (requestedStep && requestedStep !== current.inspectionStepId) {
          if (current.inspectionStepId) throw new QualityDataError('已登记的工序不能更换，请另建检验记录', 409);
          if (!actor.canManage || !reason) throw new QualityDataError('历史首件记录须由质量管理人员注明原因后补充工序', 403);
          const step = await resolveInspectionStep(tx, current.workOrderId!, requestedStep);
          update.inspectionStepId = step.id; update.inspectionStepSnapshot = json(step); data.context.processName = step.name;
        } else if (current.inspectionStepSnapshot) data.context.processName = (current.inspectionStepSnapshot as { name: string }).name;
      }
      if (status === 'SUBMITTED') { assertPaperResult(current.type, data); assertQualitySubmission(data, current.attachments.filter(file => !file.deletedAt).length); }
      update = { ...update, data: json(data), inspectedAt, title, status, result: qualityResult(data),
        reviewStatus: 'UNREVIEWED', reviewedAt: null, reviewedByName: null, reviewNote: null,
        submittedAt: current.submittedAt || (status === 'SUBMITTED' ? new Date() : null),
        searchText: searchText(current.orderSnapshot as unknown as QualityOrder, data, title, current.createdByName, current.attachments.filter(file => !file.deletedAt).map(file => file.originalName)),
      };
    } else throw new QualityDataError('操作类型无效');
    await tx.qualityDataRecord.update({ where: { id }, data: update });
    return snapshotQuality(tx, id, actor, action, reason || (action === 'SUBMIT' ? '提交质量记录' : '保存草稿'));
  });
}
export async function qualityExportRecords(params: URLSearchParams) {
  const where = qualityWhere(params);
  const records = await prisma.qualityDataRecord.findMany({ where, take: 5001, include: qualityInclude, orderBy: [{ inspectedAt: 'desc' }, { id: 'desc' }] });
  if (records.length > 5000) throw new QualityDataError('本次超过 5000 份记录，请缩小日期或订单范围后导出', 413);
  return records.map(serializeQuality);
}
export function qualityRevisionReset(): Pick<Prisma.QualityDataRecordUpdateInput, 'reviewStatus' | 'reviewedAt' | 'reviewedByName' | 'reviewNote'> {
  return { reviewStatus: 'UNREVIEWED', reviewedAt: null, reviewedByName: null, reviewNote: null };
}
