import { Prisma } from '@prisma/client';
import { sampleMaterialSource, sampleMaterialSourceSelect } from '@/lib/sample-material-source';
import { prisma } from '@/lib/prisma';
import { prepareWarehouseTaskTransition, warehouseMaterialTaskDetailInclude, warehouseLegacyMaterialStatus } from '@/lib/warehouse-material';
import { materialFollowUpDetailInclude, prepareMaterialFollowUpTransition } from '@/lib/material-follow-up';
import { MATERIAL_SOURCES, MaterialInputError, materialSource, materialSourceText, materialExceptionLabel, materialQuantity, validateMaterialAmounts } from '@/lib/material-source';
import { synchronizeMaterialProductionHold } from '@/lib/production-plan-holds';
import type { WarehouseExceptionType, WarehouseMaterialStatus } from '@/types';

type Tx = Prisma.TransactionClient;
type Input = Record<string, unknown>;
const text = (v: unknown, limit = 400) => String(v ?? '').trim().slice(0, limit);
function version(actual: number, supplied: unknown) {
  if (!Number.isInteger(supplied) || supplied !== actual) throw new MaterialInputError('记录已更新，请刷新后重试', 409);
}
async function lockWarehouse(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM warehouse_material_tasks WHERE id=${id} FOR UPDATE`;
  const task = await tx.warehouseMaterialTask.findUnique({ where: { id }, include: { sampleTask: { select: sampleMaterialSourceSelect }, workOrder: { select: { weekStartDate: true, weekEndDate: true, deletedAt: true } } } });
  if (!task || task.workOrder?.deletedAt || task.sampleTask?.deletedAt || task.sampleTask?.status === 'CANCELLED') throw new MaterialInputError('配料任务不存在或来源已取消', 404);
  return { ...task, workOrder: task.workOrder || { ...sampleMaterialSource(task.sampleTask), deletedAt: null } };
}

// All open events contribute to the order summary. Closing one event cannot close its siblings.
export async function synchronizeWarehouseExceptions(tx: Tx, id: string, actorId: string, fallback: 'pending' | 'completed' = 'pending') {
  const events = await tx.warehouseMaterialExceptionCase.findMany({ where: { warehouseTaskId: id, status: 'OPEN' }, orderBy: { sequence: 'asc' } });
  const expected = events.map(e => e.expectedArrivalAt).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] || null;
  const state = {
    status: (events.length ? 'exception' : fallback) as WarehouseMaterialStatus,
    exceptionType: events.length ? events[0].exceptionType as WarehouseExceptionType : null,
    exceptionNote: events.length ? events.map(e => `${materialExceptionLabel(e.exceptionType, e.supplySource)}：${e.exceptionNote}`).join('；').slice(0, 400) : null,
    expectedAt: expected,
    completedAt: !events.length && fallback === 'completed' ? new Date() : null,
  };
  const updated = await tx.warehouseMaterialTask.update({ where: { id }, data: { ...state, ...(state.status !== 'completed' ? { requirementsConfirmed: false } : {}), completedById: state.status === 'completed' ? actorId : null, updatedById: actorId, version: { increment: 1 } } });
  if (updated.workOrderId) {
    await tx.workOrder.update({ where: { id: updated.workOrderId }, data: { materialStatus: events.length ? state.exceptionNote!.slice(0, 200) : warehouseLegacyMaterialStatus(state) } });
    await synchronizeMaterialProductionHold(tx, { ...state, workOrderId: updated.workOrderId, warehouseTaskId: id, actorId });
  }
  return updated;
}

export async function mutateWarehouseException(id: string, input: Input, actorId: string, canConfirm: boolean) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MaterialInputError('提交内容不正确');
  return prisma.$transaction(async tx => {
    const current = await lockWarehouse(tx, id);
    version(current.version, input.version);
    const action = text(input.action, 40);
    if (current.sampleTaskId && (action === 'complete' || action === 'resolve' && input.resolution === 'completed') && !current.requirementsConfirmed) throw new MaterialInputError('请在样品配料清单中核对数量后确认完成', 409);
    if (!canConfirm && !['report_exception', 'update_exception'].includes(action)) throw new MaterialInputError('实物确认及配料完成须由仓库人员操作', 403);
    const transition = prepareWarehouseTaskTransition({ ...current, status: current.status as WarehouseMaterialStatus, exceptionType: current.exceptionType as WarehouseExceptionType | null }, input);
    if (!transition.ok) throw new MaterialInputError(transition.error, transition.statusCode);
    const now = new Date();
    let eventId = text(input.exceptionId, 80);
    let content = transition.content;
    let target = eventId ? await tx.warehouseMaterialExceptionCase.findFirst({ where: { id: eventId, warehouseTaskId: id, status: 'OPEN' }, include: { followUpTask: true } }) : null;
    if (eventId && !target) throw new MaterialInputError('所选异常已结束或不属于当前工单，请刷新', 409);
    if (['update_exception', 'resolve'].includes(action) && !target) {
      const open = await tx.warehouseMaterialExceptionCase.findMany({ where: { warehouseTaskId: id, status: 'OPEN' }, include: { followUpTask: true } });
      if (open.length !== 1) throw new MaterialInputError('请选择具体要处理的异常事项', 400);
      target = open[0]; eventId = target.id;
    }
    if (action === 'report_exception' || action === 'update_exception') {
      if (input.supplySource !== undefined && !MATERIAL_SOURCES.includes(input.supplySource as never)) throw new MaterialInputError('物料来源不正确');
      const source = materialSource(input.supplySource ?? target?.supplySource);
      const required = input.shortageQuantity === undefined ? target?.shortageQuantity ?? null : materialQuantity(input.shortageQuantity, true);
      validateMaterialAmounts(required, target?.receivedQuantity || 0);
      const details = { supplySource: source, materialModel: text(input.materialModel ?? target?.materialModel, 160), shortageQuantity: required, unit: text(input.unit ?? target?.unit, 12) || '个' };
      content = `${materialExceptionLabel(transition.next.exceptionType!, source)}：${transition.next.exceptionNote}`;
      if (action === 'report_exception') {
        const sequence = await tx.warehouseMaterialExceptionCase.aggregate({ where: { warehouseTaskId: id }, _max: { sequence: true } });
        target = await tx.warehouseMaterialExceptionCase.create({ data: { warehouseTaskId: id, sequence: (sequence._max.sequence || 0) + 1, exceptionType: transition.next.exceptionType!, exceptionNote: transition.next.exceptionNote!, ...details, reportedById: actorId, weekStartDate: current.workOrder.weekStartDate, weekEndDate: current.workOrder.weekEndDate }, include: { followUpTask: true } });
        eventId = target.id;
      } else {
        target = await tx.warehouseMaterialExceptionCase.update({ where: { id: target!.id }, data: { exceptionType: transition.next.exceptionType!, exceptionNote: transition.next.exceptionNote!, ...details }, include: { followUpTask: true } });
      }
      const ownerId = text(input.ownerId, 80);
      if (ownerId && !await tx.user.count({ where: { id: ownerId, isActive: true } })) throw new MaterialInputError('请选择有效的负责人');
      const follow = await tx.materialFollowUpTask.upsert({ where: { warehouseExceptionId: target.id }, create: { warehouseTaskId: id, warehouseExceptionId: target.id, createdById: actorId, latestProgress: content, ownerId: ownerId || null }, update: { version: { increment: 1 } } });
      await tx.materialFollowUpActivity.create({ data: { taskId: follow.id, action, content, actorId, fromStatus: follow.status, toStatus: follow.status } });
    } else if (action === 'resolve') {
      await tx.warehouseMaterialExceptionCase.update({ where: { id: target!.id }, data: { status: 'RESOLVED', resolvedAt: now, resolvedById: actorId, resolutionNote: content, actualArrivalAt: target!.actualArrivalAt || now, actualArrivalById: target!.actualArrivalById || actorId } });
      const follow = await tx.materialFollowUpTask.upsert({ where: { warehouseExceptionId: target!.id }, create: { warehouseTaskId: id, warehouseExceptionId: target!.id, status: 'RESOLVED', resolvedAt: now, resolvedById: actorId, latestProgress: content }, update: { status: 'RESOLVED', resolvedAt: now, resolvedById: actorId, latestProgress: content, lastFollowedAt: now, version: { increment: 1 } } });
      await tx.materialFollowUpActivity.create({ data: { taskId: follow.id, action: 'warehouse_confirmed_resolved', fromStatus: target!.followUpTask?.status, toStatus: 'RESOLVED', content, actorId } });
    }
    const next = await synchronizeWarehouseExceptions(tx, id, actorId, transition.next.status === 'completed' ? 'completed' : 'pending');
    await tx.warehouseMaterialActivity.create({ data: { taskId: id, action, fromStatus: current.status, toStatus: next.status, content, actorId, detail: { exceptionCaseId: eventId || null } } });
    return tx.warehouseMaterialTask.findUniqueOrThrow({ where: { id }, include: warehouseMaterialTaskDetailInclude });
  });
}

async function updateFollowUp(tx: Tx, id: string, input: Input, actorId: string) {
  const identity = await tx.materialFollowUpTask.findUnique({ where: { id }, select: { warehouseTaskId: true } });
  if (!identity) throw new MaterialInputError('物料跟进任务不存在', 404);
  await lockWarehouse(tx, identity.warehouseTaskId);
  const current = await tx.materialFollowUpTask.findUniqueOrThrow({ where: { id }, include: { warehouseException: true } });
  version(current.version, input.version);
  if (current.warehouseException.status !== 'OPEN') throw new MaterialInputError('本条异常已结束，请从仓库重新登记', 409);
  const event = current.warehouseException;
  const action = text(input.action, 20);
  const changes: string[] = [];
  let source = event.supplySource;
  if (input.supplySource !== undefined) {
    if (!MATERIAL_SOURCES.includes(input.supplySource as never)) throw new MaterialInputError('物料来源不正确');
    source = String(input.supplySource);
    if (source !== event.supplySource) changes.push(`来源：${materialSourceText[materialSource(event.supplySource)]} → ${materialSourceText[materialSource(source)]}`);
  }
  if (action === 'classify') {
    if (!changes.length) throw new MaterialInputError('来源未变化');
    await tx.warehouseMaterialExceptionCase.update({ where: { id: event.id }, data: { supplySource: source } });
    await tx.materialFollowUpTask.update({ where: { id }, data: { version: { increment: 1 } } });
  } else {
    const transition = prepareMaterialFollowUpTransition(current, input, actorId);
    if (!transition.ok) throw new MaterialInputError(transition.error, transition.statusCode);
    if (!await tx.user.count({ where: { id: transition.next.ownerId, isActive: true } })) throw new MaterialInputError('请选择有效的负责人');
    const received = input.receivedQuantity === undefined ? event.receivedQuantity : materialQuantity(input.receivedQuantity)!;
    validateMaterialAmounts(event.shortageQuantity, received);
    if (event.shortageQuantity !== null && received < event.shortageQuantity && transition.next.status === 'WAITING_WAREHOUSE') throw new MaterialInputError('当前仅部分到料，请保留跟进状态，全部到料后再提交仓库确认');
    if (received !== event.receivedQuantity) changes.push(`累计到料：${event.receivedQuantity} → ${received} ${event.unit}`);
    const dateText = (date: Date | null) => date ? date.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '待确认';
    const changedEta = current.expectedAt?.getTime() !== transition.next.expectedAt?.getTime();
    if (changedEta) changes.push(`预计到料：${dateText(current.expectedAt)} → ${dateText(transition.next.expectedAt)}`);
    changes.unshift(transition.content);
    const arrived = transition.next.status === 'WAITING_WAREHOUSE';
    await tx.warehouseMaterialExceptionCase.update({ where: { id: event.id }, data: { supplySource: source, receivedQuantity: received, expectedArrivalAt: transition.next.expectedAt, ...(changedEta ? { expectedArrivalById: actorId, expectedArrivalUpdatedAt: new Date() } : {}), actualArrivalAt: arrived ? event.actualArrivalAt || new Date() : null, actualArrivalById: arrived ? event.actualArrivalById || actorId : null } });
    await tx.materialFollowUpTask.update({ where: { id }, data: { ...transition.next, version: { increment: 1 } } });
  }
  const next = await tx.materialFollowUpTask.findUniqueOrThrow({ where: { id }, include: materialFollowUpDetailInclude });
  const content = changes.join('；');
  await tx.materialFollowUpActivity.create({ data: { taskId: id, action, fromStatus: current.status, toStatus: next.status, content, actorId } });
  await tx.warehouseMaterialActivity.create({ data: { taskId: current.warehouseTaskId, action: `material_follow_up_${action}`, content, actorId, detail: { exceptionCaseId: event.id } } });
  await synchronizeWarehouseExceptions(tx, current.warehouseTaskId, actorId);
  return tx.materialFollowUpTask.findUniqueOrThrow({ where: { id }, include: materialFollowUpDetailInclude });
}

export async function mutateMaterialFollowUp(id: string, input: Input, actorId: string) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MaterialInputError('提交内容不正确');
  return prisma.$transaction(tx => updateFollowUp(tx, id, input, actorId));
}
export async function classifyMaterialFollowUps(items: { id: string; version: number }[], supplySource: string, actorId: string) {
  if (!Array.isArray(items) || !items.length || items.length > 100 || items.some(i => !i || typeof i.id !== 'string' || !i.id || !Number.isInteger(i.version)) || new Set(items.map(i => i.id)).size !== items.length) throw new MaterialInputError('请选择 1 至 100 条不同的待处理事项');
  if (!['PURCHASED', 'CUSTOMER'].includes(supplySource)) throw new MaterialInputError('请选择采购或客供来源');
  return prisma.$transaction(async tx => {
    const identities = await tx.materialFollowUpTask.findMany({ where: { id: { in: items.map(i => i.id) } }, select: { warehouseTaskId: true } });
    for (const id of [...new Set(identities.map(i => i.warehouseTaskId))].sort()) await lockWarehouse(tx, id);
    for (const item of items) await updateFollowUp(tx, item.id, { action: 'classify', version: item.version, supplySource }, actorId);
    return items.length;
  }, { timeout: 20000 });
}
