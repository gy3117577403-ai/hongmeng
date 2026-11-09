import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { materialLossAccess, materialLossReviewers, lossVisibility, type MaterialLossAccess } from './material-loss-access';
import { MaterialLossError, lossFields, lossQuantity, lossText, lossDay } from './material-loss-domain';
import { sampleCustomerLabel } from './sample-display';
import { createSystemNotification } from './system-notifications';

type Tx = Prisma.TransactionClient;
export const lossInclude = { attachments: { where: { deletedAt: null }, select: { id: true, originalName: true, size: true, contentType: true } }, root: { select: { replenishment: true } }, correction: { select: { id: true, number: true, status: true } } } satisfies Prisma.MaterialLossInclude;
const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export function serializeLoss(record: Prisma.MaterialLossGetPayload<{ include: typeof lossInclude }>) {
  const { root, ...row } = record;
  return { ...row, kittingReviewedAt: row.kittingReviewedAt?.toISOString() || null, quantity: row.quantity?.toString() ?? '', replenishmentQuantity: row.replenishmentQuantity?.toString() ?? '',
    occurredOn: row.occurredOn?.toISOString().slice(0, 10) || '', expectedOn: row.expectedOn?.toISOString().slice(0, 10) || '',
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), submittedAt: row.submittedAt?.toISOString() || null,
    reviewedAt: row.reviewedAt?.toISOString() || null, supersededAt: row.supersededAt?.toISOString() || null,
    replenishment: root.replenishment ? { ...root.replenishment, quantity: root.replenishment.quantity.toString(), receivedQuantity: root.replenishment.receivedQuantity.toString(),
      createdAt: root.replenishment.createdAt.toISOString(), updatedAt: root.replenishment.updatedAt.toISOString(), verifiedAt: root.replenishment.verifiedAt?.toISOString() || null } : null };
}
export type MaterialLossDTO = ReturnType<typeof serializeLoss>;
function requiredVersion(actual: number, input: unknown) {
  if (!Number.isSafeInteger(input) || input !== actual) throw new MaterialLossError('记录已更新，请刷新后核对再操作', 409);
}
async function audit(tx: Tx, lossId: string, action: string, actor: MaterialLossAccess, note = '') {
  const snapshot = await tx.materialLoss.findUniqueOrThrow({ where: { id: lossId }, include: { attachments: { where: { deletedAt: null }, select: { id: true, originalName: true, objectKey: true } }, root: { select: { replenishment: true } } } });
  await tx.materialLossEvent.create({ data: { lossId, action, actorId: actor.id, actorName: actor.name, note, snapshot: jsonValue(snapshot) } });
}
export async function lossTarget(tx: Tx, id: unknown) {
  if (!id) return { warehouseTaskId: null, targetLabel: '仓库公共损耗' };
  const task = await tx.warehouseMaterialTask.findUnique({ where: { id: lossText(id, 100, '关联订单') }, include: {
    workOrder: { select: { code: true, specification: true, customerName: true, deletedAt: true } },
    sampleTask: { select: { code: true, specificationSnapshot: true, customerNameSnapshot: true, deletedAt: true, status: true } },
    planOrder: { select: { sourceOrderNo: true, specification: true, customerName: true, deletedAt: true, status: true } },
  } });
  if (!task || task.workOrder?.deletedAt || task.sampleTask?.deletedAt || task.sampleTask?.status === 'CANCELLED' || task.planOrder?.deletedAt || task.planOrder?.status === 'cancelled') throw new MaterialLossError('关联订单不存在或已取消，请重新选择');
  const label = task.sampleTask ? `样品 · ${task.sampleTask.code} · ${task.sampleTask.specificationSnapshot} · ${sampleCustomerLabel(task.sampleTask.customerNameSnapshot)}` : task.workOrder ? `量产 · ${task.workOrder.code} · ${task.workOrder.specification} · ${task.workOrder.customerName}` : task.planOrder ? `订单池 · ${task.planOrder.sourceOrderNo} · ${task.planOrder.specification} · ${task.planOrder.customerName}` : '';
  if (!label) throw new MaterialLossError('关联配料任务缺少来源，请重新选择');
  return { warehouseTaskId: task.id, targetLabel: label.slice(0, 500) };
}
export async function getMaterialLoss(id: string, actorId: string) {
  const access = await materialLossAccess(actorId);
  const record = await prisma.materialLoss.findFirst({ where: { AND: [{ id }, lossVisibility(access)] }, include: lossInclude });
  if (!record) throw new MaterialLossError('损耗单不存在或不可查看', 404);
  const history = await prisma.materialLossEvent.findMany({ where: { lossId: id }, select: { id: true, action: true, actorName: true, note: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 100 });
  return { record: serializeLoss(record), history, access };
}
function queryWhere(params: URLSearchParams, access: MaterialLossAccess): Prisma.MaterialLossWhereInput {
  const q = (params.get('q') || '').trim().slice(0, 120), status = params.get('status') || '', source = params.get('source') || '', warehouseTaskId = params.get('warehouseTaskId') || '';
  if (status && !['DRAFT', 'PENDING', 'RETURNED', 'APPROVED', 'WITHDRAWN'].includes(status)) throw new MaterialLossError('状态不正确');
  if (source && !['PURCHASED', 'CUSTOMER'].includes(source)) throw new MaterialLossError('物料来源不正确');
  const from = lossDay(params.get('from'), '开始'), to = lossDay(params.get('to'), '结束');
  if (from && to && from > to) throw new MaterialLossError('开始日期不能晚于结束日期');
  return { AND: [lossVisibility(access), { ...(status ? { status } : {}), ...(source ? { supplySource: source } : {}), ...(warehouseTaskId ? { warehouseTaskId } : {}), ...(params.get('mine') === 'true' ? { applicantId: access.id } : {}), ...(from || to ? { occurredOn: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(q ? { OR: ['number', 'materialName', 'materialModel', 'targetLabel', 'applicantName', 'reason'].map(field => ({ [field]: { contains: q, mode: 'insensitive' } })) } : {}) }] };
}
export async function listMaterialLoss(params: URLSearchParams, actorId: string, exporting = false) {
  const access = await materialLossAccess(actorId), where = queryWhere(params, access);
  return prisma.$transaction(async tx => {
    const total = await tx.materialLoss.count({ where });
    if (exporting && total > 5000) throw new MaterialLossError('导出最多 5000 条，请缩小日期或筛选范围');
    const page = Math.min(Math.max(1, Math.floor(Number(params.get('page')) || 1)), Math.max(1, Math.ceil(total / 20)));
    const rows = await tx.materialLoss.findMany({ where, include: lossInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: exporting ? 0 : (page - 1) * 20, take: exporting ? 5000 : 20 });
    const totals = await tx.materialLoss.groupBy({ by: ['unit'], where: { AND: [where, { status: 'APPROVED', supersededAt: null }] }, _sum: { quantity: true } });
    return { records: rows.map(serializeLoss), access, pagination: { page, total, pages: Math.max(1, Math.ceil(total / 20)) }, totals: totals.map(t => ({ unit: t.unit, quantity: t._sum.quantity?.toString() || '0' })) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export async function mutateMaterialLoss(actorId: string, input: Record<string, unknown>, id?: string) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MaterialLossError('提交格式不正确');
  const action = lossText(input.action, 40, '操作'), key = lossText(input.requestKey, 100, '请求编号');
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) throw new MaterialLossError('请求编号无效，请刷新后重试');
  if (!['create', 'save', 'submit', 'withdraw', 'approve', 'return', 'correct', 'replenishment'].includes(action)) throw new MaterialLossError('不支持的操作');
  const hash = createHash('sha256').update(JSON.stringify({ id, input })).digest('hex');
  return prisma.$transaction(async tx => {
    const actor = await materialLossAccess(actorId, tx);
    if (['approve', 'return'].includes(action) ? !actor.approve : !actor.report) throw new MaterialLossError('当前账号没有此操作的独立权限', 403);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    const replay = await tx.materialLossCommand.findUnique({ where: { key } });
    if (replay) {
      if (replay.actorId !== actorId || replay.payloadHash !== hash) throw new MaterialLossError('请求编号已用于其他操作，请刷新', 409);
      return serializeLoss(await tx.materialLoss.findUniqueOrThrow({ where: { id: replay.lossId }, include: lossInclude }));
    }
    if (id) await tx.$queryRaw`SELECT id FROM material_losses WHERE id = ${id} FOR UPDATE`;
    const current = id ? await tx.materialLoss.findUnique({ where: { id }, include: lossInclude }) : null;
    if (action !== 'create' && !current) throw new MaterialLossError('损耗单不存在', 404);
    if (current && action !== 'replenishment') requiredVersion(current.version, input.version);
    if (current && !['approve', 'return', 'replenishment'].includes(action) && current.applicantId !== actorId) throw new MaterialLossError('只能处理本人申报的损耗单', 403);
    const note = lossText(input.note, 2000, '说明');
    let lossId = current?.id || randomUUID();
    if (action === 'create' || action === 'correct') {
      if (action === 'create' && id) throw new MaterialLossError('创建请求不能指定旧单据');
      if (current && (current.status !== 'APPROVED' || current.supersededAt)) throw new MaterialLossError('只能更正当前有效的已批准记录', 409);
      if (current?.correction) throw new MaterialLossError('已有更正单，请打开该更正单继续处理', 409);
      lossId = randomUUID();
      const fields = current ? lossFields({ ...current, quantity: current.quantity?.toString(), replenishmentQuantity: current.replenishmentQuantity?.toString(), occurredOn: current.occurredOn?.toISOString().slice(0, 10), expectedOn: current.expectedOn?.toISOString().slice(0, 10), correctionReason: '' }) : lossFields(input);
      const target = current ? { warehouseTaskId: current.warehouseTaskId, targetLabel: current.targetLabel } : await lossTarget(tx, input.warehouseTaskId);
      await tx.materialLoss.create({ data: { id: lossId, rootId: current?.rootId || lossId, correctsId: current?.id, number: `SH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`, applicantId: actor.id, applicantName: actor.name, ...fields, ...target } });
    } else if (current) {
      if (action === 'save') {
        if (!['DRAFT', 'RETURNED', 'WITHDRAWN'].includes(current.status)) throw new MaterialLossError('仅草稿、退回或撤回的单据可以修改', 409);
        const fields = lossFields(input), target = await lossTarget(tx, input.warehouseTaskId);
        if (current.correctsId) {
          const base = await tx.materialLoss.findUniqueOrThrow({ where: { id: current.correctsId } });
          // Existing physical replenishment facts are never rewritten by an accounting correction.
          for (const field of ['warehouseTaskId', 'materialName', 'materialModel', 'unit', 'supplySource', 'needReplenishment', 'replenishmentQuantity', 'expectedOn'] as const) {
            const previous = base[field], next = field === 'warehouseTaskId' ? target.warehouseTaskId : fields[field];
            if (String(previous ?? '') !== String(next ?? '')) throw new MaterialLossError('更正单须保留原物料、订单和补料安排；补料实物情况请在原补料任务中记录');
          }
        }
        await tx.materialLoss.update({ where: { id: lossId }, data: { ...fields, ...target, status: 'DRAFT', version: { increment: 1 } } });
      } else if (action === 'submit') {
        if (!['DRAFT', 'RETURNED', 'WITHDRAWN'].includes(current.status)) throw new MaterialLossError('当前状态不能提交', 409);
        lossFields({ ...current, quantity: current.quantity?.toString(), replenishmentQuantity: current.replenishmentQuantity?.toString(), occurredOn: current.occurredOn?.toISOString().slice(0, 10), expectedOn: current.expectedOn?.toISOString().slice(0, 10) }, true);
        if (current.correctsId && !current.correctionReason.trim()) throw new MaterialLossError('请填写更正原因');
        if (current.affectsKitting && !current.warehouseTaskId) throw new MaterialLossError('影响配齐时请选择关联订单或样品');
        await lossTarget(tx, current.warehouseTaskId);
        const reviewers = await materialLossReviewers(tx, current.applicantId);
        if (!reviewers.length) throw new MaterialLossError('没有可审批的其他人员。草稿已保留，请在账号权限中为其他人员开通物料损耗审批');
        await tx.materialLoss.update({ where: { id: lossId }, data: { status: 'PENDING', submittedAt: new Date(), reviewNote: '', reviewerId: null, reviewerName: null, reviewedAt: null, version: { increment: 1 } } });
        await createSystemNotification(tx, { eventType: 'MATERIAL_LOSS_SUBMITTED', sourceType: 'MATERIAL_LOSS', sourceId: lossId, actorId, dedupeKey: `material-loss:${lossId}:submit:${current.version}`, category: 'APPROVAL', title: `${actor.name}的物料损耗待审批`, body: `${current.materialModel} · ${current.quantity} ${current.unit}`, targetRoute: `/workspace/material-loss?id=${lossId}`, recipientUserIds: reviewers });
      } else if (action === 'withdraw' || action === 'approve' || action === 'return') {
        if (current.status !== 'PENDING') throw new MaterialLossError('审批状态已变化，请刷新', 409);
        if (action !== 'withdraw' && current.applicantId === actorId) throw new MaterialLossError('不能审批本人提交的损耗单', 403);
        if (action === 'return' && !note) throw new MaterialLossError('退回时请填写原因');
        if (action === 'approve' && current.correctsId) {
          await tx.$queryRaw`SELECT id FROM material_losses WHERE id = ${current.correctsId} FOR UPDATE`;
          const base = await tx.materialLoss.findUniqueOrThrow({ where: { id: current.correctsId } });
          if (base.status !== 'APPROVED' || base.supersededAt) throw new MaterialLossError('原记录已有新的生效更正，请刷新', 409);
          await tx.materialLoss.update({ where: { id: base.id }, data: { supersededAt: new Date(), version: { increment: 1 } } });
        }
        const status = action === 'approve' ? 'APPROVED' : action === 'return' ? 'RETURNED' : 'WITHDRAWN';
        await tx.materialLoss.update({ where: { id: lossId }, data: { status, reviewNote: note, ...(action !== 'withdraw' ? { reviewerId: actorId, reviewerName: actor.name, reviewedAt: new Date() } : {}), version: { increment: 1 } } });
        if (action === 'approve' && current.needReplenishment && !current.correctsId) await tx.materialLossReplenishment.create({ data: { lossId: current.rootId, quantity: current.replenishmentQuantity! } });
        await tx.systemNotificationRecipient.updateMany({ where: { notification: { sourceType: 'MATERIAL_LOSS', sourceId: lossId, eventType: 'MATERIAL_LOSS_SUBMITTED' }, completedAt: null }, data: { completedAt: new Date(), completionKind: 'SOURCE_RESOLVED', completionReason: status } });
        if (action !== 'withdraw') await createSystemNotification(tx, { eventType: `MATERIAL_LOSS_${status}`, sourceType: 'MATERIAL_LOSS', sourceId: lossId, actorId, dedupeKey: `material-loss:${lossId}:${status}:${current.version}`, category: 'TODO', title: `物料损耗${action === 'approve' ? '已通过' : '已退回'}`, body: note || `${current.materialModel} · ${current.quantity} ${current.unit}`, targetRoute: `/workspace/material-loss?id=${lossId}`, recipientUserIds: [current.applicantId] });
      } else if (action === 'replenishment') {
        if (current.applicantId !== actorId) throw new MaterialLossError('补料进展由本单申报人员记录和核验', 403);
        if (current.status !== 'APPROVED' || current.supersededAt) throw new MaterialLossError('请从当前有效的已通过记录处理补料', 409);
        await tx.$queryRaw`SELECT id FROM material_loss_replenishments WHERE loss_id = ${current.rootId} FOR UPDATE`;
        const rep = await tx.materialLossReplenishment.findUnique({ where: { lossId: current.rootId } });
        if (!rep) throw new MaterialLossError('未生成补料任务', 404);
        requiredVersion(rep.version, input.replenishmentVersion);
        if (rep.status === 'COMPLETED') throw new MaterialLossError('补料已完成，历史核验结果不可覆盖', 409);
        if (!note) throw new MaterialLossError('请记录本次补料进展或实物核验说明');
        const quantity = new Prisma.Decimal(lossQuantity(input.receivedQuantity, false, true)!);
        if (quantity.lt(rep.receivedQuantity) || quantity.gt(rep.quantity)) throw new MaterialLossError('累计可用到料不能减少，也不能超过补料数量');
        const complete = input.complete === true;
        if (complete && !quantity.eq(rep.quantity)) throw new MaterialLossError('累计可用到料尚未达到补料数量');
        if (complete && input.physicalVerified !== true) throw new MaterialLossError('请确认已经核对实物');
        await tx.materialLossReplenishment.update({ where: { id: rep.id }, data: { receivedQuantity: quantity, progress: note, status: complete ? 'COMPLETED' : 'IN_PROGRESS', ...(complete ? { verifiedAt: new Date(), verifiedById: actorId } : {}), version: { increment: 1 } } });
      }
    }
    await audit(tx, lossId, action, actor, note);
    await tx.materialLossCommand.create({ data: { key, actorId, payloadHash: hash, lossId } });
    return serializeLoss(await tx.materialLoss.findUniqueOrThrow({ where: { id: lossId }, include: lossInclude }));
  }, { timeout: 20000 });
}
