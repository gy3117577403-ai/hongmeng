import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { MaterialInputError, materialQuantity, materialSource, materialSourceText } from '@/lib/material-source';
import { materialAmounts, materialForecast, materialOrderState, materialEventPhase } from '@/lib/material-order-domain';
import { updateWarehouseException, synchronizeWarehouseExceptions } from '@/lib/material-exception-service';
import { sampleMaterialSourceSelect, sampleMaterialSource } from '@/lib/sample-material-source';
import { lockOrderPool, confirmPoolQuantity, distributePoolCoverage } from './order-pool-material';
import { poolQuantities, poolInteger, PoolError } from './order-pool-domain';

const actor = { select: { id: true, displayName: true, username: true } } as const;
export const materialOrderInclude = Prisma.validator<Prisma.WarehouseMaterialTaskInclude>()({
  planOrder: { include: { batches: { where: { deletedAt: null }, select: { quantity: true, poolPreparedQuantity: true } } } },
  workOrder: { select: { id: true, code: true, productName: true, specification: true, customerName: true, productionTargetQty: true, uncompletedQty: true, weekStartDate: true, weekEndDate: true, deliveryDay: true, deletedAt: true, productionPlanBatch: { select: { batchNo: true, scheduleState: true, scheduleReason: true, deletedAt: true, plannedCompletionDate: true, planOrder: { select: { customerDueDate: true, customerDueDateConfirmed:true, status: true, deletedAt: true } } } } } },
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
  const pool = task.planOrder;
  const source = work || (pool ? { code: pool.sourceOrderNo, specification: pool.specification, productName: pool.productName, customerName: pool.customerName, productionTargetQty: pool.preparationQuantity ?? pool.orderQuantity, uncompletedQty: null, weekStartDate: null, weekEndDate: null } : sampleMaterialSource(task.sampleTask));
  const events = task.exceptionCases.map(e => {
    const amounts = materialAmounts(e.shortageQuantity, e.arrivals);
    // Closed historical events have no new receipt ledger. Preserve their confirmed outcome.
    if (!e.arrivals.length && e.status === 'RESOLVED') {
      amounts.usable = e.shortageQuantity ?? e.receivedQuantity; amounts.remaining = 0; amounts.missing = 0;
    }
    const arrivals = e.arrivals.map(b => ({ ...b, createdAt: iso(b.createdAt)!, updatedAt: iso(b.updatedAt)!, expectedAt: iso(b.expectedAt), shippedAt: iso(b.shippedAt), arrivedAt: iso(b.arrivedAt), verifiedAt: iso(b.verifiedAt) }));
    return { id: e.id, sequence: e.sequence, status: e.status, source: e.supplySource, model: e.materialModel || e.exceptionNote, note: e.exceptionNote, required: e.shortageQuantity, unit: e.unit,
      expectedAt: iso(e.expectedArrivalAt), resolvedAt: iso(e.resolvedAt), reportedAt: iso(e.reportedAt), followUpId: e.followUpTask?.id || null,
      progress: e.followUpTask?.latestProgress || e.exceptionNote, progressAt: iso(e.followUpTask?.lastFollowedAt), ...amounts, arrivals,
      arrivalOutcome: e.arrivalOutcome,
      phase: materialEventPhase({ status: e.status, required: e.shortageQuantity, arrivalOutcome: e.arrivalOutcome, ...amounts }),
    };
  });
  const open = events.filter(e => e.status === 'OPEN');
  const shortageCount = open.filter(e => !['WAITING_VERIFY', 'NEEDS_COMPLETION'].includes(e.phase)).length;
  const completionCount = open.filter(e => e.phase === 'NEEDS_COMPLETION').length;
  const forecast = materialForecast(open.filter(e => e.phase !== 'NEEDS_COMPLETION').map(e => ({ open: true, remaining: e.remaining, expectedAt: e.expectedAt })));
  const pendingBatches = open.reduce((n, e) => n + e.arrivals.filter(b => b.status === 'ARRIVED').length, 0);
  const detail = task as Record;
  return { id: task.id, workOrderId: task.workOrderId, sampleTaskId: task.sampleTaskId, version: task.version,
    planOrderId: task.planOrderId, preparationTaskId: task.preparationTaskId, preparedQuantity: task.preparedQuantity,
    poolQuantities: pool ? poolQuantities(pool.orderQuantity, pool.preparationQuantity, task.preparedQuantity, pool.batches) : null,
    preparationRank: pool?.preparationRank || 0, preparationPriority: pool?.priority || 'normal', preparationDueAt: iso(pool?.preparationDueAt), preparationNote: pool?.preparationNote || '',
    code: source.code, specification: source.specification || source.productName, productName: source.productName, customer: source.customerName,
    quantity: source.productionTargetQty ?? source.uncompletedQty ?? 0, weekStart: iso(source.weekStartDate), weekEnd: iso(source.weekEndDate),
    dueDate: pool ? (pool.customerDueDateConfirmed ? iso(pool.customerDueDate) : null) : (work?.productionPlanBatch ? (work.productionPlanBatch.planOrder.customerDueDateConfirmed ? iso(work.productionPlanBatch.planOrder.customerDueDate) : null) : (work?.deliveryDay || null)),
    batchNo: work?.productionPlanBatch?.batchNo || null, scheduleState: work?.productionPlanBatch?.scheduleState || 'ACTIVE', scheduleReason: work?.productionPlanBatch?.scheduleReason || null, cancelled: !!pool?.deletedAt || pool?.status === 'cancelled' || !!work?.deletedAt || !!work?.productionPlanBatch?.deletedAt || !!work?.productionPlanBatch?.planOrder.deletedAt || work?.productionPlanBatch?.planOrder.status === 'cancelled' || task.sampleTask?.status === 'CANCELLED',
    state: open.length && !shortageCount ? (completionCount ? 'COMPLETION' as const : 'WAITING' as const) : pool && task.preparedQuantity > 0 && !open.length && task.status !== 'completed' ? 'PARTIAL' as const : materialOrderState(task.status, open.length, events.filter(e => e.status === 'RESOLVED').length), status: task.status,
    shortageCount, completionCount,
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
    await lockOrderPool(tx);
    await tx.$queryRaw`SELECT id FROM warehouse_material_tasks WHERE id=${id} FOR UPDATE`;
    const current = await tx.warehouseMaterialTask.findUnique({ where: { id }, include: materialOrderInclude });
    if (!current) throw new MaterialInputError('配料订单不存在', 404);
    const replay = await tx.materialOrderCommand.findUnique({ where: { taskId_key: { taskId: id, key } } });
    if (replay) {
      if (replay.hash !== hash) throw new MaterialInputError('操作编号已使用，请重新提交', 409);
      return serializeMaterialOrder(await tx.warehouseMaterialTask.findUniqueOrThrow({ where: { id }, include: materialOrderDetailInclude }));
    }
    if (serializeMaterialOrder(current).cancelled || current.sampleTask?.deletedAt || current.planOrder && (current.planOrder.deletedAt || ['cancelled','completed'].includes(current.planOrder.status))) throw new MaterialInputError('订单已取消，仅可查看历史记录', 409);
    if (action !== 'note' && (!Number.isInteger(suppliedVersion) || current.version !== suppliedVersion)) throw new MaterialInputError('订单已被更新，已刷新数据；请核对后重新提交', 409);
    if (['verify_arrivals', 'confirm_prepared', 'confirm_arrival', 'confirm_outcome', 'cancel_duplicate', 'verify_arrival', 'complete', 'reopen', 'resolve'].includes(action) && !canConfirm) throw new MaterialInputError('需要仓库到料确认权限', 403);
    if (input.workspace === 'warehouse' && ['record_shipment', 'cancel_shipment', 'report_arrival', 'eta'].includes(action)) throw new MaterialInputError('发货与交期请在物料追踪中维护', 400);
    const now = new Date();
    let content = text(input.note), eventId = text(input.exceptionId, 100), arrivalId = text(input.arrivalId, 100);
    let event = current.exceptionCases.find(e => e.id === eventId);
    const auditDetail: { [key: string]: Prisma.InputJsonValue | null } = { exceptionCaseId: eventId || null, arrivalId: arrivalId || null, requestKey: key };
    if (action === 'verify_arrivals') {
      if (current.status === 'completed') throw new MaterialInputError('已配齐订单请先重新核对', 409);
      const entries = input.entries as { arrivalId?: unknown; acceptedQuantity?: unknown; itemComplete?: unknown }[];
      if (!Array.isArray(entries) || !entries.length || entries.length > 100 || entries.some(e => !e || typeof e !== 'object')) throw new MaterialInputError('请选择 1 至 100 批待核验到料');
      if (new Set(entries.map(e => e.arrivalId)).size !== entries.length) throw new MaterialInputError('同一批次不能重复核验');
      const affected = new Map<string, boolean>();
      const rejectedItems = new Set<string>();
      for (const entry of entries) {
        const item = current.exceptionCases.find(e => e.status === 'OPEN' && e.arrivals.some(b => b.id === entry.arrivalId));
        const batch = item?.arrivals.find(b => b.id === entry.arrivalId);
        if (!item || !batch || batch.status !== 'ARRIVED') throw new MaterialInputError('所选批次已核验、尚未报到或不属于本单，请刷新', 409);
        const accepted = materialQuantity(entry.acceptedQuantity)!;
        if (accepted > batch.quantity) throw new MaterialInputError('可用数量不能超过本批报到数量');
        const rejected = Math.round((batch.quantity - accepted) * 1e6) / 1e6;
        if (rejected > 0 && !content) throw new MaterialInputError('请说明少到、错料或不合格原因');
        if (rejected > 0 && entry.itemComplete === true) throw new MaterialInputError('本批仍有异常待补，不能确认本项补齐');
        if (rejected > 0) rejectedItems.add(item.id);
        await tx.materialArrivalBatch.update({ where: { id: batch.id }, data: { status: 'VERIFIED', acceptedQuantity: accepted, rejectedQuantity: rejected, verifiedAt: now, verifiedById: actorId, note: content || batch.note } });
        affected.set(item.id, affected.get(item.id) === true || entry.itemComplete === true);
        await tx.warehouseMaterialActivity.create({ data: { taskId: id, action: 'verify_arrival', actorId,
          content: `${item.materialModel}：仓库核验可用 ${accepted} ${item.unit}${rejected ? `，需补货 ${rejected}` : ''}${content ? `；${content}` : ''}`,
          detail: { exceptionCaseId: item.id, arrivalId: batch.id, requestKey: key, acceptedQuantity: accepted, rejectedQuantity: rejected } } });
      }
      for (const [itemId, complete] of affected) {
        if (complete && rejectedItems.has(itemId)) throw new MaterialInputError('本项仍有异常待补，不能确认补齐');
        const item = await tx.warehouseMaterialExceptionCase.findUniqueOrThrow({ where: { id: itemId }, include: { arrivals: true } });
        const totals = materialAmounts(item.shortageQuantity, item.arrivals);
        if (complete && (totals.pending || totals.transit)) throw new MaterialInputError('确认本项补齐前，请先核验本项全部批次');
        const solved = !totals.pending && !totals.transit && (item.shortageQuantity === null ? complete : totals.usable + 1e-6 >= item.shortageQuantity);
        const status = solved ? 'RESOLVED' : totals.pending > 0 && totals.remaining === 0 ? 'WAITING_WAREHOUSE' : 'IN_PROGRESS';
        const progress = `批量核验后累计可用 ${totals.usable} ${item.unit}，${solved ? '本项已补齐' : item.shortageQuantity === null ? '待确认补齐结果' : `仍缺 ${totals.missing} ${item.unit}`}`;
        await tx.warehouseMaterialExceptionCase.update({ where: { id: itemId }, data: { receivedQuantity: totals.usable + totals.pending,
          ...(solved ? { status: 'RESOLVED', resolvedAt: now, resolvedById: actorId, resolutionNote: content || progress, arrivalOutcome: 'COMPLETE' } : {}) } });
        const follow = await tx.materialFollowUpTask.upsert({ where: { warehouseExceptionId: itemId },
          create: { warehouseTaskId: id, warehouseExceptionId: itemId, createdById: actorId, status, latestProgress: progress, lastFollowedAt: now, ...(solved ? { resolvedAt: now, resolvedById: actorId } : {}) },
          update: { status, latestProgress: progress, lastFollowedAt: now, version: { increment: 1 }, ...(solved ? { resolvedAt: now, resolvedById: actorId } : {}) } });
        await tx.materialFollowUpActivity.create({ data: { taskId: follow.id, action, content: progress, actorId, toStatus: status } });
      }
      await synchronizeWarehouseExceptions(tx, id, actorId);
      if (input.confirmComplete === true) {
        if (input.physicalConfirmed !== true) throw new MaterialInputError('请确认已按实物核对产品配套数量');
        if (current.planOrderId) {
          try { await confirmPoolQuantity(tx, id, poolInteger(input.preparedQuantity, '累计可配套数量'), actorId); }
          catch (e) { if (e instanceof PoolError) throw new MaterialInputError(e.message, e.status); throw e; }
        } else {
          const latest = await tx.warehouseMaterialTask.findUniqueOrThrow({ where: { id } });
          await updateWarehouseException(tx, id, { action: 'complete', version: latest.version, note: content || '仓库批量核验并确认整单齐料' }, actorId, true);
        }
      }
    } else if (action === 'confirm_prepared' || current.planOrderId && action === 'complete') {
      try { await confirmPoolQuantity(tx,id,poolInteger(input.preparedQuantity,'累计可配套数量'),actorId); } catch(e) { if(e instanceof PoolError) throw new MaterialInputError(e.message,e.status); throw e; }
    } else if (current.planOrderId && action === 'reopen') {
      await synchronizeWarehouseExceptions(tx,id,actorId);
      await tx.warehouseMaterialActivity.create({data:{taskId:id,action,actorId,content:content||'仓库重新核对订单池配套数量'}});
    } else if (['report_exception', 'update_exception', 'complete', 'reopen'].includes(action)) {
      if (action === 'report_exception' && current.exceptionCases.some(e => e.status === 'OPEN' && e.materialModel === text(input.materialModel,160) && e.supplySource === input.supplySource && e.unit === (text(input.unit,12) || '个'))) throw new MaterialInputError('本单已登记相同来源、型号与单位的缺料，请修改已有明细', 409);
      let version = current.version;
      if (action === 'report_exception' && current.status === 'completed') {
        if (!canConfirm) throw new MaterialInputError('已配齐订单需由仓库重新登记缺料', 403);
        await updateWarehouseException(tx, id, { action: 'reopen', version, note: '重新登记缺料，撤销整单齐料确认' }, actorId, true);
        version = (await tx.warehouseMaterialTask.findUniqueOrThrow({ where: { id }, select: { version: true } })).version;
      }
      await updateWarehouseException(tx, id, { ...input, departmentCollaboration: true, ownerId: undefined, version, exceptionNote: text(input.exceptionNote) || text(input.materialModel) }, actorId, canConfirm);
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
        } else if (action === 'confirm_arrival') {
          const outcome = text(input.arrivalOutcome, 20) || (input.itemComplete === true ? 'COMPLETE' : '');
          if (outcome && !['PARTIAL', 'COMPLETE'].includes(outcome)) throw new MaterialInputError('请选择本次到料后的补齐结果');
          const itemComplete = outcome === 'COMPLETE';
          if (outcome) await tx.warehouseMaterialExceptionCase.update({ where: { id: event.id }, data: { arrivalOutcome: outcome } });
          if (itemComplete && event.shortageQuantity === null && !batch && !input.quantity) {
            if (amounts.pending || amounts.transit) throw new MaterialInputError('请先确认已登记的到料批次');
            content = `仓库确认本项已补齐${content ? `；${content}` : ''}`;
            await tx.warehouseMaterialExceptionCase.update({ where: { id: event.id }, data: { status: 'RESOLVED', resolvedAt: now, resolvedById: actorId, resolutionNote: content } });
          } else {
            if (arrivalId && !batch || batch && !['SHIPPED', 'ARRIVED'].includes(batch.status)) throw new MaterialInputError('本批已确认或状态已变化，请刷新', 409);
            const quantity = materialQuantity(input.quantity)!;
            const accepted = input.acceptedQuantity == null || input.acceptedQuantity === '' ? quantity : materialQuantity(input.acceptedQuantity)!;
            if (quantity <= 0 || accepted > quantity) throw new MaterialInputError('请核对本次到料及可用数量');
            const limit = batch?.quantity ?? amounts.unallocated;
            if (limit !== null && quantity > limit + 1e-6) throw new MaterialInputError('本次数量超过所选批次或尚未登记的缺料数量');
            const rejected = Math.round((quantity - accepted) * 1e6) / 1e6;
            if (rejected > 0 && !content) throw new MaterialInputError('请说明少料、错料或来料异常');
            if (rejected > 0 && itemComplete) throw new MaterialInputError('本次仍有异常待补，请保留未解决状态');
            const verified = { status: 'VERIFIED', acceptedQuantity: accepted, rejectedQuantity: rejected, arrivedAt: now, verifiedAt: now, verifiedById: actorId, note: content || batch?.note || '' };
            if (batch && Math.abs(batch.quantity - quantity) < 1e-6) {
              await tx.materialArrivalBatch.update({ where: { id: batch.id }, data: verified });
              arrivalId = batch.id;
            } else {
              if (batch) await tx.materialArrivalBatch.update({ where: { id: batch.id }, data: { quantity: Math.round((batch.quantity - quantity) * 1e6) / 1e6 } });
              const receipt = await tx.materialArrivalBatch.create({ data: { ...verified, exceptionId: event.id, quantity, logisticsMode: batch?.logisticsMode || 'UNKNOWN', carrier: batch?.carrier || '', trackingNumber: batch?.trackingNumber || '', expectedAt: batch?.expectedAt || null, shippedAt: batch?.shippedAt || null, recordedById: actorId } });
              arrivalId = receipt.id;
            }
            auditDetail.arrivalId = arrivalId;
            content = `仓库确认到料 ${quantity} ${event.unit}，可用 ${accepted}${rejected ? `，异常待补 ${rejected}` : ''}${content ? `；${content}` : ''}`;
            if (itemComplete && event.shortageQuantity === null) {
              const unsettled = await tx.materialArrivalBatch.count({ where: { exceptionId: event.id, status: { in: ['SHIPPED', 'ARRIVED'] } } });
              if (unsettled) throw new MaterialInputError('本项仍有在途或待确认批次');
              await tx.warehouseMaterialExceptionCase.update({ where: { id: event.id }, data: { status: 'RESOLVED', resolvedAt: now, resolvedById: actorId, resolutionNote: content } });
            }
            if (rejected > 0) await tx.warehouseMaterialExceptionCase.update({ where: { id: event.id }, data: { arrivalOutcome: 'PARTIAL' } });
            if (outcome === 'PARTIAL') content += '；仓库确认仍有缺料待补';
            if (outcome === 'COMPLETE' && event.shortageQuantity !== null && amounts.usable + accepted + 1e-6 < event.shortageQuantity) throw new MaterialInputError('累计可用数量尚未达到登记缺料数量，不能确认全部补齐');
          }
        } else if (action === 'confirm_outcome') {
          const outcome = text(input.arrivalOutcome, 20);
          if (!['PARTIAL', 'COMPLETE'].includes(outcome)) throw new MaterialInputError('请选择仍有缺料或本项全部补齐');
          if (outcome === 'COMPLETE' && (amounts.pending || amounts.transit)) throw new MaterialInputError('请先处理本项的在途及待核验批次');
          if (outcome === 'COMPLETE' && event.shortageQuantity !== null && amounts.usable + 1e-6 < event.shortageQuantity) throw new MaterialInputError('核验可用数量尚未达到缺料数量');
          if (!content) throw new MaterialInputError('请填写现场核对结果');
          content = `${outcome === 'COMPLETE' ? '仓库核对本项全部补齐' : '仓库核对仍有缺料待补'}；${content}`;
          await tx.warehouseMaterialExceptionCase.update({ where: { id: event.id }, data: { arrivalOutcome: outcome, ...(outcome === 'COMPLETE' ? { status: 'RESOLVED', resolvedAt: now, resolvedById: actorId, resolutionNote: content } : {}) } });
        } else if (action === 'cancel_duplicate') {
          const reference = current.exceptionCases.find(e => e.id === input.referenceExceptionId && e.id !== event.id && e.status !== 'CANCELLED');
          if (!reference || reference.materialModel.trim().toLocaleLowerCase() !== event.materialModel.trim().toLocaleLowerCase() || reference.unit !== event.unit) throw new MaterialInputError('请选择本单同型号、同单位的保留事项');
          if (event.arrivals.some(b => b.status !== 'CANCELLED') || event.receivedQuantity > 0) throw new MaterialInputError('本项已有发货或到料记录，不能作为空白重复项撤销，请逐批核对');
          if (input.confirmDuplicate !== true || !content) throw new MaterialInputError('请确认两条记录属于同一实际需求，并填写核对依据');
          content = `仓库撤销重复事项 #${event.sequence}（${materialSourceText[materialSource(event.supplySource)]}），以 #${reference.sequence}（${materialSourceText[materialSource(reference.supplySource)]}）为准；${content}`;
          auditDetail.referenceExceptionId = reference.id;
          await tx.warehouseMaterialExceptionCase.update({ where: { id: event.id }, data: { status: 'CANCELLED', resolvedAt: now, resolvedById: actorId, resolutionNote: content } });
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
        const solved = fresh.status === 'RESOLVED' || (['verify_arrival', 'confirm_arrival'].includes(action) && fresh.shortageQuantity !== null && amounts.usable + 1e-6 >= fresh.shortageQuantity && !amounts.pending && !amounts.transit);
        const cancelled = fresh.status === 'CANCELLED';
        const status = cancelled ? 'CANCELLED' : solved ? 'RESOLVED' : amounts.pending > 0 && amounts.remaining === 0 ? 'WAITING_WAREHOUSE' : fresh.expectedArrivalAt ? 'WAITING_ARRIVAL' : 'IN_PROGRESS';
        if (action !== 'note' && action !== 'eta') await tx.warehouseMaterialExceptionCase.update({ where: { id: event.id }, data: { receivedQuantity: amounts.usable + amounts.pending, ...(solved ? { status: 'RESOLVED', resolvedAt: now, resolvedById: actorId, resolutionNote: content } : {}), ...(['report_arrival', 'confirm_arrival'].includes(action) ? { actualArrivalAt: now, actualArrivalById: actorId } : {}) } });
        const follow = await tx.materialFollowUpTask.upsert({ where: { warehouseExceptionId: event.id }, create: { warehouseTaskId: id, warehouseExceptionId: event.id, createdById: actorId, status, expectedAt: fresh.expectedArrivalAt, latestProgress: content, lastFollowedAt: now }, update: { ...(action !== 'note' ? { status, expectedAt: fresh.expectedArrivalAt } : {}), ...(solved || cancelled ? { resolvedAt: now, resolvedById: actorId } : {}), latestProgress: content, lastFollowedAt: now, version: { increment: 1 } } });
        await tx.materialFollowUpActivity.create({ data: { taskId: follow.id, action, content, actorId, toStatus: follow.status } });
      }
      await tx.warehouseMaterialActivity.create({ data: { taskId: id, action, content, actorId, detail: auditDetail } });
      if (action === 'note') await tx.warehouseMaterialTask.update({ where: { id }, data: { version: { increment: 1 }, updatedById: actorId } });
      else await synchronizeWarehouseExceptions(tx, id, actorId);
    }
    if (action === 'confirm_arrival' && input.confirmComplete === true && current.planOrderId) throw new MaterialInputError('请单独确认产品可配套数量，物料数量不能自动换算为套数');
    if (action === 'confirm_arrival' && input.confirmComplete === true) {
      const latest = await tx.warehouseMaterialTask.findUniqueOrThrow({ where: { id }, select: { version: true } });
      await updateWarehouseException(tx, id, { action: 'complete', version: latest.version, note: '到料确认并核对整单物料齐全' }, actorId, true);
    }
    if (current.planOrderId && ['reopen','report_exception','update_exception'].includes(action)) {
      if (action === 'reopen') await tx.warehouseMaterialTask.update({ where: { id }, data: { preparedQuantity: 0 } });
      else if(action==='report_exception'){
        const credit=await tx.productionPlanBatch.aggregate({where:{planOrderId:current.planOrderId,deletedAt:null},_sum:{poolPreparedQuantity:true}});
        await tx.warehouseMaterialTask.update({where:{id},data:{preparedQuantity:Math.min(current.preparedQuantity,credit._sum.poolPreparedQuantity||0)}});
      }
      await distributePoolCoverage(tx,current.planOrderId,actorId);
    }
    await tx.materialOrderCommand.create({ data: { taskId: id, key, hash } });
    return serializeMaterialOrder(await tx.warehouseMaterialTask.findUniqueOrThrow({ where: { id }, include: materialOrderDetailInclude }));
  }, { timeout: 20000 });
}
