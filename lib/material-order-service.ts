import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { MaterialInputError, materialQuantity } from '@/lib/material-source';
import { materialAmounts, materialForecast, materialOrderState } from '@/lib/material-order-domain';
import { updateWarehouseException, synchronizeWarehouseExceptions } from '@/lib/material-exception-service';
import { sampleMaterialSourceSelect, sampleMaterialSource } from '@/lib/sample-material-source';

const actor = { select: { id: true, displayName: true, username: true } } as const;
export const materialOrderInclude = Prisma.validator<Prisma.WarehouseMaterialTaskInclude>()({
  workOrder: { select: { id: true, code: true, productName: true, specification: true, customerName: true, productionTargetQty: true, uncompletedQty: true, weekStartDate: true, weekEndDate: true, deliveryDay: true, deletedAt: true, productionPlanBatch: { select: { batchNo: true, deletedAt: true, plannedCompletionDate: true, planOrder: { select: { customerDueDate: true, status: true, deletedAt: true } } } } } },
  sampleTask: { select: sampleMaterialSourceSelect },
  completedBy: actor,
  exceptionCases: { orderBy: { sequence: 'asc' }, include: {
    arrivals: { orderBy: { createdAt: 'asc' } },
    followUpTask: { select: { id: true, status: true, latestProgress: true, lastFollowedAt: true } },
  } },
});
export const materialOrderDetailInclude = Prisma.validator<Prisma.WarehouseMaterialTaskInclude>()({
  ...materialOrderInclude,
  activities: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 80, include: { actor } },
});
type Record = Prisma.WarehouseMaterialTaskGetPayload<{ include: typeof materialOrderDetailInclude }>;
type ListRecord = Prisma.WarehouseMaterialTaskGetPayload<{ include: typeof materialOrderInclude }>;
const iso = (v: Date | null | undefined) => v?.toISOString() || null;
export function serializeMaterialOrder(task: ListRecord | Record) {
  const work = task.workOrder;
  const source = work || sampleMaterialSource(task.sampleTask);
  const events = task.exceptionCases.map(e => {
    const amounts = materialAmounts(e.shortageQuantity, e.arrivals);
    // Closed historical events have no new receipt ledger. Preserve their confirmed outcome.
    if (!e.arrivals.length && e.status === 'RESOLVED') {
      amounts.usable = e.shortageQuantity ?? e.receivedQuantity; amounts.remaining = 0;
    }
    const arrivals = e.arrivals.map(b => ({ ...b, createdAt: iso(b.createdAt)!, updatedAt: iso(b.updatedAt)!, expectedAt: iso(b.expectedAt), shippedAt: iso(b.shippedAt), arrivedAt: iso(b.arrivedAt), verifiedAt: iso(b.verifiedAt) }));
    return { id: e.id, sequence: e.sequence, status: e.status, source: e.supplySource, model: e.materialModel || e.exceptionNote, note: e.exceptionNote, required: e.shortageQuantity, unit: e.unit,
      expectedAt: iso(e.expectedArrivalAt), resolvedAt: iso(e.resolvedAt), reportedAt: iso(e.reportedAt), followUpId: e.followUpTask?.id || null,
      progress: e.followUpTask?.latestProgress || e.exceptionNote, progressAt: iso(e.followUpTask?.lastFollowedAt), ...amounts, arrivals,
    };
  });
  const open = events.filter(e => e.status === 'OPEN');
  const forecast = materialForecast(open.map(e => ({ open: true, remaining: e.remaining, expectedAt: e.expectedAt })));
  const pendingBatches = open.reduce((n, e) => n + e.arrivals.filter(b => b.status === 'ARRIVED').length, 0);
  const detail = task as Record;
  return { id: task.id, workOrderId: task.workOrderId, sampleTaskId: task.sampleTaskId, version: task.version,
    code: source.code, specification: source.specification || source.productName, productName: source.productName, customer: source.customerName,
    quantity: source.productionTargetQty ?? source.uncompletedQty ?? 0, weekStart: iso(source.weekStartDate), weekEnd: iso(source.weekEndDate),
    dueDate: iso(work?.productionPlanBatch?.planOrder.customerDueDate) || (work?.deliveryDay || null),
    batchNo: work?.productionPlanBatch?.batchNo || null, cancelled: !!work?.deletedAt || !!work?.productionPlanBatch?.deletedAt || !!work?.productionPlanBatch?.planOrder.deletedAt || work?.productionPlanBatch?.planOrder.status === 'cancelled' || task.sampleTask?.status === 'CANCELLED',
    state: materialOrderState(task.status, open.length, events.filter(e => e.status === 'RESOLVED').length), status: task.status,
    openCount: open.length, purchased: open.filter(e => e.source === 'PURCHASED').length, customerProvided: open.filter(e => e.source === 'CUSTOMER').length,
    unknownSource: open.filter(e => e.source === 'UNKNOWN').length, pendingBatches, forecast, events,
    completedAt: iso(task.completedAt), completedBy: task.completedBy?.displayName || task.completedBy?.username || '', updatedAt: iso(task.updatedAt)!,
    activities: (detail.activities || []).map(a => ({ id: a.id, content: a.content || '', action: a.action, at: iso(a.createdAt)!, actor: a.actor?.displayName || a.actor?.username || '系统', detail: a.detail })),
  };
}
export type MaterialOrderDTO = ReturnType<typeof serializeMaterialOrder>;
const text = (v: unknown, max = 600) => String(v ?? '').trim().slice(0, max);
function date(v: unknown, optional = true): Date | null {
  if (!v && optional) return null;
  const s = text(v, 40);
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T23:59:59+08:00` : s);
  if (Number.isNaN(d.getTime())) throw new MaterialInputError('日期格式不正确');
  return d;
}
export async function readMaterialOrder(id: string) {
  const task = await prisma.warehouseMaterialTask.findUnique({ where: { id }, include: materialOrderDetailInclude });
  if (!task) throw new MaterialInputError('配料订单不存在', 404);
  return serializeMaterialOrder(task);
}

/** One order lock and one transaction cover receipts, projections, activity and retry keys. */
export async function mutateMaterialOrder(id: string, input: { [key: string]: unknown }, actorId: string, canConfirm: boolean) {
  const action = text(input.action, 40), key = text(input.requestKey, 100);
  if (!key) throw new MaterialInputError('缺少操作编号，请刷新后重试');
  const { version: suppliedVersion, requestKey: _key, ...payload } = input;
  const hash = createHash('sha256').update(JSON.stringify({ actorId, payload })).digest('hex');
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM warehouse_material_tasks WHERE id=${id} FOR UPDATE`;
    const current = await tx.warehouseMaterialTask.findUnique({ where: { id }, include: materialOrderInclude });
    if (!current) throw new MaterialInputError('配料订单不存在', 404);
    const replay = await tx.materialOrderCommand.findUnique({ where: { taskId_key: { taskId: id, key } } });
    if (replay) {
      if (replay.hash !== hash) throw new MaterialInputError('操作编号已使用，请重新提交', 409);
      return serializeMaterialOrder(await tx.warehouseMaterialTask.findUniqueOrThrow({ where: { id }, include: materialOrderDetailInclude }));
    }
    if (serializeMaterialOrder(current).cancelled || current.sampleTask?.deletedAt) throw new MaterialInputError('订单已取消，仅可查看历史记录', 409);
    if (action !== 'note' && (!Number.isInteger(suppliedVersion) || current.version !== suppliedVersion)) throw new MaterialInputError('订单已被更新，已刷新数据；请核对后重新提交', 409);
    if (['verify_arrival', 'complete', 'reopen', 'resolve'].includes(action) && !canConfirm) throw new MaterialInputError('需要仓库核验权限', 403);
    const now = new Date();
    let content = text(input.note), eventId = text(input.exceptionId, 100), arrivalId = text(input.arrivalId, 100);
    let event = current.exceptionCases.find(e => e.id === eventId);
    const auditDetail: { [key: string]: Prisma.InputJsonValue | null } = { exceptionCaseId: eventId || null, arrivalId: arrivalId || null, requestKey: key };
    if (['report_exception', 'update_exception', 'complete', 'reopen'].includes(action)) {
      if (action === 'report_exception' && current.exceptionCases.some(e => e.status === 'OPEN' && e.materialModel === text(input.materialModel,160) && e.supplySource === input.supplySource && e.unit === (text(input.unit,12) || '个'))) throw new MaterialInputError('本单已登记相同来源、型号与单位的缺料，请修改已有明细', 409);
      if (action === 'update_exception' && event) {
        const allocated = materialAmounts(event.shortageQuantity, event.arrivals);
        const required = materialQuantity(input.shortageQuantity, true);
        if (required !== null && required < allocated.usable + allocated.pending + allocated.transit) throw new MaterialInputError('登记数量不能小于已核验、待核验与在途数量；请先处理对应批次');
      }
      await updateWarehouseException(tx, id, { ...input, departmentCollaboration: true, ownerId: undefined, version: current.version, exceptionNote: text(input.exceptionNote) || text(input.materialModel) }, actorId, canConfirm);
    } else {
      if (current.status === 'completed') throw new MaterialInputError('已配齐订单请先由仓库重新核对', 409);
      if (action === 'note') {
        if (!content) throw new MaterialInputError('请填写进展');
        if (eventId && (!event || event.status !== 'OPEN')) throw new MaterialInputError('所选缺料已结束，请切换为本单进展', 409);
      } else {
        if (!event || event.status !== 'OPEN') throw new MaterialInputError('缺料已结束或不属于当前订单', 409);
        const amounts = materialAmounts(event.shortageQuantity, event.arrivals);
        const batch = event.arrivals.find(b => b.id === arrivalId);
        if (action === 'eta') {
          const expected = date(input.expectedAt);
          const source = text(input.supplySource, 20) || event.supplySource;
          if (!['PURCHASED', 'CUSTOMER', 'UNKNOWN'].includes(source)) throw new MaterialInputError('物料来源不正确');
          content = `预计到料 ${event.expectedArrivalAt?.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }) || '待确认'} → ${expected?.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }) || '待确认'}${content ? `；${content}` : ''}`;
          if (source !== event.supplySource) content += `；来源 ${event.supplySource} → ${source}`;
          await tx.warehouseMaterialExceptionCase.update({ where: { id: event.id }, data: { expectedArrivalAt: expected, expectedArrivalById: actorId, expectedArrivalUpdatedAt: now, supplySource: source } });
        } else if (action === 'record_shipment' || (action === 'report_arrival' && !batch)) {
          if (arrivalId) throw new MaterialInputError('到料批次不存在');
          const quantity = materialQuantity(input.quantity)!;
          if (quantity <= 0) throw new MaterialInputError('本批数量必须大于 0');
          if (amounts.unallocated !== null && quantity > amounts.unallocated + 0.000001) throw new MaterialInputError(`本单尚未登记批次的缺料为 ${amounts.unallocated} ${event.unit}，请核对数量`);
          const mode = text(input.logisticsMode, 20) || 'EXPRESS';
          if (!['EXPRESS', 'SELF_DELIVERY', 'PICKUP', 'UNKNOWN'].includes(mode)) throw new MaterialInputError('物流方式不正确');
          const expected = date(input.expectedAt), shipped = date(input.shippedAt) || (action === 'record_shipment' ? now : null), arrived = action === 'report_arrival' ? date(input.arrivedAt) || now : null;
          if (shipped && shipped > now || arrived && arrived > now) throw new MaterialInputError('实际发货或到料时间不能在未来');
          const created = await tx.materialArrivalBatch.create({ data: { exceptionId: event.id, quantity, status: arrived ? 'ARRIVED' : 'SHIPPED', logisticsMode: mode, carrier: text(input.carrier, 60), trackingNumber: text(input.trackingNumber, 100), expectedAt: expected, shippedAt: shipped, arrivedAt: arrived, note: content, recordedById: actorId } });
          arrivalId = created.id; auditDetail.arrivalId = arrivalId;
          content = `${arrived ? '报到料' : '登记发货'} ${quantity} ${event.unit}${created.trackingNumber ? ` · ${created.carrier} ${created.trackingNumber}` : ''}${content ? `；${content}` : ''}`;
          if (expected) await tx.warehouseMaterialExceptionCase.update({ where: { id: event.id }, data: { expectedArrivalAt: expected, expectedArrivalById: actorId, expectedArrivalUpdatedAt: now } });
        } else if (action === 'report_arrival') {
          if (!batch || batch.status !== 'SHIPPED') throw new MaterialInputError('本批已报到或不可重复报到', 409);
          const arrived = date(input.arrivedAt) || now;
          if (arrived > now) throw new MaterialInputError('实际到料时间不能在未来');
          await tx.materialArrivalBatch.update({ where: { id: batch.id }, data: { status: 'ARRIVED', arrivedAt: arrived } });
          content = `本批 ${batch.quantity} ${event.unit} 已报到，待仓库核验${content ? `；${content}` : ''}`;
        } else if (action === 'verify_arrival') {
          if (!batch || batch.status !== 'ARRIVED') throw new MaterialInputError('本批已核验或尚未报到，请刷新', 409);
          const accepted = materialQuantity(input.acceptedQuantity)!;
          if (accepted > batch.quantity) throw new MaterialInputError('合格数量不能超过本批数量');
          const rejected = Math.round((batch.quantity - accepted) * 1e6) / 1e6;
          if (rejected > 0 && !content) throw new MaterialInputError('请说明不合格、少到或错料原因');
          await tx.materialArrivalBatch.update({ where: { id: batch.id }, data: { status: 'VERIFIED', acceptedQuantity: accepted, rejectedQuantity: rejected, verifiedAt: now, verifiedById: actorId, note: content || batch.note } });
          content = `仓库核验：可用 ${accepted} ${event.unit}${rejected ? `，需补齐 ${rejected} ${event.unit}` : ''}${content ? `；${content}` : ''}`;
        } else if (action === 'cancel_shipment') {
          if (!batch || batch.status !== 'SHIPPED') throw new MaterialInputError('只可取消尚未报到的发货批次', 409);
          if (!content) throw new MaterialInputError('请填写取消原因');
          await tx.materialArrivalBatch.update({ where: { id: batch.id }, data: { status: 'CANCELLED', note: content } });
          content = `取消发货 ${batch.quantity} ${event.unit}；${content}`;
        } else if (action === 'resolve') {
          if (event.arrivals.some(b => ['SHIPPED', 'ARRIVED'].includes(b.status))) throw new MaterialInputError('请先处理本项的在途及待核验批次');
          if (event.shortageQuantity !== null && amounts.usable < event.shortageQuantity) throw new MaterialInputError('核验可用数量尚未达到缺料数量');
          if (!content) throw new MaterialInputError('请填写仓库核实结果');
          await tx.warehouseMaterialExceptionCase.update({ where: { id: event.id }, data: { status: 'RESOLVED', resolvedAt: now, resolvedById: actorId, resolutionNote: content } });
        } else throw new MaterialInputError('不支持的操作');
      }
      if (event) {
        const fresh = await tx.warehouseMaterialExceptionCase.findUniqueOrThrow({ where: { id: event.id }, include: { arrivals: true } });
        const amounts = materialAmounts(fresh.shortageQuantity, fresh.arrivals);
        const solved = fresh.status === 'RESOLVED' || (action === 'verify_arrival' && fresh.shortageQuantity !== null && amounts.usable + 1e-6 >= fresh.shortageQuantity && !amounts.pending && !amounts.transit);
        const status = solved ? 'RESOLVED' : amounts.pending > 0 && amounts.remaining === 0 ? 'WAITING_WAREHOUSE' : fresh.expectedArrivalAt ? 'WAITING_ARRIVAL' : 'IN_PROGRESS';
        if (action !== 'note' && action !== 'eta') await tx.warehouseMaterialExceptionCase.update({ where: { id: event.id }, data: { receivedQuantity: amounts.usable + amounts.pending, ...(solved ? { status: 'RESOLVED', resolvedAt: now, resolvedById: actorId, resolutionNote: content } : {}), ...(action === 'report_arrival' ? { actualArrivalAt: now, actualArrivalById: actorId } : {}) } });
        const follow = await tx.materialFollowUpTask.upsert({ where: { warehouseExceptionId: event.id }, create: { warehouseTaskId: id, warehouseExceptionId: event.id, createdById: actorId, status, expectedAt: fresh.expectedArrivalAt, latestProgress: content, lastFollowedAt: now }, update: { ...(action !== 'note' ? { status, expectedAt: fresh.expectedArrivalAt } : {}), ...(solved ? { resolvedAt: now, resolvedById: actorId } : {}), latestProgress: content, lastFollowedAt: now, version: { increment: 1 } } });
        await tx.materialFollowUpActivity.create({ data: { taskId: follow.id, action, content, actorId, toStatus: follow.status } });
      }
      await tx.warehouseMaterialActivity.create({ data: { taskId: id, action, content, actorId, detail: auditDetail } });
      if (action === 'note') await tx.warehouseMaterialTask.update({ where: { id }, data: { version: { increment: 1 }, updatedById: actorId } });
      else await synchronizeWarehouseExceptions(tx, id, actorId);
    }
    await tx.materialOrderCommand.create({ data: { taskId: id, key, hash } });
    return serializeMaterialOrder(await tx.warehouseMaterialTask.findUniqueOrThrow({ where: { id }, include: materialOrderDetailInclude }));
  }, { timeout: 20000 });
}
