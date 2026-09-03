import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { productionWorkOrderScopeWhere } from '@/lib/production-execution';
import { assertProductionScopeRead, resolveProductionEntityScope, type ProductionScopeSubject } from '@/lib/production-access-scope';
import { canAdjustProductionDates, canManageProductionControl, ProductionControlError, productionDateKey, productionReason, serializeProductionControl } from '@/lib/production-control';
import { loadProductionWipSourceGate, lockProductionWorkOrder } from '@/lib/production-pause-guard';
import { productionPlanningDateBoundary } from '@/lib/production-planning-date';
import { syncProductionBatchToDueShipmentPlan } from '@/lib/daily-shipment-sync';

export type ProductionControlActor = ProductionScopeSubject & { id: string; username: string; displayName?: string | null };
export type ProductionControlAction = 'note' | 'pause' | 'resume' | 'adjust_date';
export type ProductionControlCommand = {
  action?: unknown; expectedVersion?: unknown; expectedPlanVersion?: unknown; requestId?: unknown;
  text?: unknown; category?: unknown; owner?: unknown; followUpAt?: unknown; expectedResumeAt?: unknown;
  reason?: unknown; dateKind?: unknown; date?: unknown; confirmation?: unknown; confirmImpact?: unknown;
  wipAllocationId?: unknown;
};

function text(value: unknown, max = 500): string {
  if (value !== undefined && value !== null && typeof value !== 'string') throw new ProductionControlError('文本格式不正确');
  const result = String(value || '').trim();
  if (result.length > max) throw new ProductionControlError(`内容不能超过 ${max} 个字`);
  return result;
}
function optionalDate(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) throw new ProductionControlError('日期格式不正确');
  const date = new Date(value.length === 10 ? `${value}T00:00:00+08:00` : value);
  if (!Number.isFinite(date.getTime()) || (value.length === 10 && productionDateKey(date) !== value)) throw new ProductionControlError('日期格式不正确');
  return date.toISOString();
}
function dateOnly(value: unknown): Date {
  const date = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !optionalDate(date)) throw new ProductionControlError('请选择有效日期');
  return new Date(`${date}T00:00:00.000Z`);
}
const snapshot = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function visibleProductionControlOrder(actor: ProductionControlActor, workOrderId: string, tx: Prisma.TransactionClient = prisma) {
  const scope = resolveProductionEntityScope(actor);
  assertProductionScopeRead(scope);
  const order = await tx.workOrder.findFirst({ where: { id: workOrderId, deletedAt: null, ...productionWorkOrderScopeWhere(scope) } });
  if (!order) throw new ProductionControlError('工单不存在或不在可见范围内', 'WORK_ORDER_NOT_FOUND', 404);
  const rootId = order.rootWorkOrderId || order.id;
  if (rootId === order.id) return order;
  const root = await tx.workOrder.findFirst({ where: { id: rootId, deletedAt: null, ...productionWorkOrderScopeWhere(scope) } });
  if (!root) throw new ProductionControlError('无权管理该批次主工单', 'PRODUCTION_CONTROL_FORBIDDEN', 403);
  return root;
}

export async function getProductionControl(actor: ProductionControlActor, workOrderId: string) {
  const order = await visibleProductionControlOrder(actor, workOrderId);
  const [events, branches, batch, routes] = await Promise.all([
    prisma.productionControlEvent.findMany({ where: { workOrderId: order.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 }),
    prisma.workOrder.findMany({ where: { deletedAt: null, OR: [{ id: order.id }, { rootWorkOrderId: order.id }] }, select: { id: true, code: true, stage: true, branchStatus: true } }),
    prisma.productionPlanBatch.findUnique({ where: { workOrderId: order.id }, include: { planOrder: { include: { batches: { where: { deletedAt: null }, select: { id: true, workOrderId: true, batchNo: true } } } } } }),
    prisma.workOrderProcessRoute.findMany({ where: { workOrder: { deletedAt: null, OR: [{ id: order.id }, { rootWorkOrderId: order.id }] } },
      select: { id: true, version: true, workOrder: { select: { code: true } }, steps: { where: { retiredAt: null }, orderBy: { position: 'asc' }, select: { id: true, processName: true, status: true } } } }),
  ]);
  return {
    workOrderId: order.id, code: order.businessCode || order.code, ...serializeProductionControl(order),
    permissions: { manage: canManageProductionControl(actor), adjustDates: canAdjustProductionDates(actor) },
    planVersion: batch?.planOrder.deliveryVersion ?? null,
    routes,
    affectedOrders: branches,
    customerDateImpact: batch ? { orderNo: batch.planOrder.sourceOrderNo, batchCount: batch.planOrder.batches.length } : null,
    events: events.map(event => ({ id: event.id, action: event.action, reason: event.reason, actor: event.actorName,
      at: event.createdAt.toISOString(), before: event.beforeData, after: event.afterData })),
  };
}

export async function mutateProductionControl(actor: ProductionControlActor, workOrderId: string, input: ProductionControlCommand) {
  const action = text(input.action, 30) as ProductionControlAction;
  if (!['note', 'pause', 'resume', 'adjust_date'].includes(action)) throw new ProductionControlError('操作不正确');
  if (!canManageProductionControl(actor) || (action === 'adjust_date' && !canAdjustProductionDates(actor))) {
    throw new ProductionControlError(action === 'adjust_date' ? '只有计划和管理员可以调整交期' : '没有维护生产备注或暂停恢复的权限', 'PRODUCTION_CONTROL_FORBIDDEN', 403);
  }
  const requestId = text(input.requestId, 160);
  if (!requestId) throw new ProductionControlError('缺少请求标识');
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new ProductionControlError('缺少有效版本，请刷新后重试');
  const reason = text(input.reason);
  const actorName = actor.displayName || actor.username;
  const requestHash = createHash('sha256').update(JSON.stringify({ actor: actor.id, workOrderId, input })).digest('hex');
  try {
    const rootId = await prisma.$transaction(async tx => {
      const visible = await visibleProductionControlOrder(actor, workOrderId, tx);
      const root = await lockProductionWorkOrder(tx, visible.id);
      const replay = await tx.productionControlEvent.findUnique({ where: { requestId } });
      if (replay) {
        if (replay.actorId !== actor.id || replay.workOrderId !== root.id || replay.requestHash !== requestHash) {
          throw new ProductionControlError('请求标识已用于其他操作', 'PRODUCTION_CONTROL_REPLAY_CONFLICT', 409);
        }
        return root.id;
      }
      if (root.productionControlVersion !== expectedVersion) throw new ProductionControlError('备注、暂停或日期刚被其他人更新，请刷新后重试', 'PRODUCTION_CONTROL_VERSION_CONFLICT', 409);
      if (action === 'resume') {
        const wipSourceGate = await loadProductionWipSourceGate(tx, root);
        if (wipSourceGate.fullyMovedOut) {
          const wipAllocationId = text(input.wipAllocationId, 80);
          const targetAllocation = wipAllocationId
            ? await tx.wipWeekAllocation.findFirst({
                where: {
                  id: wipAllocationId,
                  status: { in: ['ACTIVE', 'IN_PROGRESS'] },
                  lot: {
                    workOrderId: root.id,
                    productionPlanBatchId: wipSourceGate.productionPlanBatchId || undefined,
                    scheduleStatus: { not: 'CANCELLED' },
                  },
                },
                select: { id: true },
              })
            : null;
          if (!targetAllocation) {
            throw new ProductionControlError(
              '该来源订单已全部转入半成品仓，不能从原订单恢复生产；请进入目标周紫色半成品续作行操作。',
              'PRODUCTION_WIP_SOURCE_RESUME_BLOCKED',
              409,
            );
          }
        }
      }
      const closed = root.stage === 'completed' || root.deletedAt || root.planClearedAt;
      if (closed && action !== 'note') throw new ProductionControlError('已完成或归档工单不能暂停、恢复或改期', 'PRODUCTION_CONTROL_CLOSED', 409);
      const now = new Date();
      const before = serializeProductionControl(root);
      const data: Prisma.WorkOrderUpdateInput = { productionControlVersion: { increment: 1 } };
      let impact: Record<string, unknown> = {};
      if (action === 'note') {
        const noteText = text(input.text);
        data.operationalNote = noteText ? {
          text: noteText, category: productionReason(input.category), owner: text(input.owner, 120),
          followUpAt: optionalDate(input.followUpAt), updatedAt: now.toISOString(), updatedBy: actorName,
        } : Prisma.DbNull;
      }
      if (action === 'pause' || action === 'resume') {
        if (!reason) throw new ProductionControlError('请填写暂停或恢复原因');
        if (input.confirmImpact !== true) throw new ProductionControlError('请确认本批次及关联未完成分支的影响范围');
        if ((action === 'pause') === Boolean(root.productionPausedAt)) throw new ProductionControlError(action === 'pause' ? '工单已经暂停' : '工单当前没有暂停', 'PRODUCTION_PAUSE_STATE_CONFLICT', 409);
        const affected = await tx.workOrder.findMany({ where: { deletedAt: null, OR: [{ id: root.id }, { rootWorkOrderId: root.id }] }, select: { id: true } });
        impact = { workOrderIds: affected.map(item => item.id) };
        if (action === 'pause') {
          const expectedResumeAt = optionalDate(input.expectedResumeAt);
          const followUpAt = optionalDate(input.followUpAt);
          if (!expectedResumeAt && !followUpAt) throw new ProductionControlError('预计恢复日期未知时，请设置下次跟进时间');
          data.productionPausedAt = now;
          data.productionPause = { reason, category: productionReason(input.category), owner: text(input.owner, 120),
            expectedResumeAt, followUpAt, pausedBy: actorName, accumulatedMilliseconds: before.accumulatedPauseMilliseconds };
          const suspended = await tx.dailyProcessTask.updateMany({
            where: { workOrderId: { in: affected.map(item => item.id) }, workDate: { gte: productionPlanningDateBoundary(now) },
              status: { notIn: ['COMPLETED', 'CARRIED_OVER', 'CANCELLED'] } },
            data: { productionSuspendedAt: now, version: { increment: 1 } },
          });
          impact.suspendedTaskCount = suspended.count;
        } else {
          data.productionPausedAt = null;
          data.productionPause = { ...(root.productionPause as Prisma.JsonObject || {}),
            resumedAt: now.toISOString(), resumedBy: actorName, resumeReason: reason,
            accumulatedMilliseconds: before.accumulatedPauseMilliseconds + Math.max(0, now.getTime() - root.productionPausedAt!.getTime()) };
          // Suspended arrangements are deliberately not reactivated; continuation/reassignment must be explicit.
        }
      }
      if (action === 'adjust_date') {
        if (!reason) throw new ProductionControlError('请填写改期原因');
        const date = dateOnly(input.date);
        const kind = text(input.dateKind, 20);
        data.deliveryAdjustmentCount = { increment: 1 };
        data.deliveryBaselineDay = root.deliveryBaselineDay || root.deliveryDay;
        data.planBaselineAt = root.planBaselineAt || root.plannedAt;
        const batch = await tx.productionPlanBatch.findUnique({ where: { workOrderId: root.id }, include: { planOrder: true } });
        if (kind === 'customer') {
          const confirmation = text(input.confirmation);
          if (!confirmation || input.confirmImpact !== true) throw new ProductionControlError('请填写客户确认说明并确认受影响的订单批次');
          const nextDate = productionDateKey(date)!;
          if (nextDate === before.customerDueDate) throw new ProductionControlError('新交期与当前交期相同');
          data.deliveryDay = nextDate;
          data.deliveryBaselineDay = root.deliveryBaselineDay || root.deliveryDay || nextDate;
          impact = { affectedWorkOrderIds: [root.id], confirmation };
          if (batch) {
            if (Number(input.expectedPlanVersion) !== batch.planOrder.deliveryVersion) throw new ProductionControlError('订单交期已变化，请刷新影响范围后重试', 'PRODUCTION_DATE_VERSION_CONFLICT', 409);
            const linked = await tx.productionPlanBatch.findMany({ where: { planOrderId: batch.planOrderId, deletedAt: null }, include: { workOrder: true } });
            const open = linked.flatMap(item => item.workOrder && item.workOrder.stage !== 'completed' && !item.workOrder.deletedAt && !item.workOrder.planClearedAt ? [item.workOrder] : []);
            await tx.productionPlanOrder.update({ where: { id: batch.planOrderId }, data: {
              customerDueDate: date, customerDueDateConfirmed: true,
              deliveryBaselineDate: batch.planOrder.deliveryBaselineDate || (batch.planOrder.customerDueDateConfirmed ? batch.planOrder.customerDueDate : date),
              deliveryVersion: { increment: 1 }, updatedById: actor.id,
            } });
            for (const sibling of open.filter(item => item.id !== root.id)) {
              await tx.workOrder.update({ where: { id: sibling.id }, data: {
                deliveryDay: nextDate, deliveryBaselineDay: sibling.deliveryBaselineDay || sibling.deliveryDay || nextDate,
                productionControlVersion: { increment: 1 }, deliveryAdjustmentCount: { increment: 1 },
              } });
              await tx.productionControlEvent.create({ data: { workOrderId: sibling.id, action, reason,
                actorId: actor.id, actorName, requestId: `${requestId}:${sibling.id}`, requestHash,
                beforeData: snapshot(serializeProductionControl(sibling)), afterData: { customerDueDate: nextDate, confirmation, sourceWorkOrderId: root.id } } });
            }
            for (const linkedBatch of linked) {
              await syncProductionBatchToDueShipmentPlan(tx, {
                batchId: linkedBatch.id,
                actorId: actor.id,
                reason: 'due_date_change',
                now,
              });
            }
            impact = { affectedWorkOrderIds: open.map(item => item.id), confirmation };
            await tx.productionPlanChange.create({ data: { planOrderId: batch.planOrderId, action: 'adjust_customer_due_date', reason,
              actorId: actor.id, beforeData: { customerDueDate: productionDateKey(batch.planOrder.customerDueDate) },
              afterData: { customerDueDate: nextDate, confirmation }, impactData: snapshot(impact) } });
          }
        } else if (kind === 'estimated') {
          if (productionDateKey(date) === before.estimatedCompletionDate) throw new ProductionControlError('新预计完成日与当前日期相同');
          data.estimatedCompletionAt = date;
          if (batch) {
            await tx.productionPlanBatch.update({ where: { id: batch.id }, data: { estimatedCompletionDate: date, planBaselineDate: batch.planBaselineDate || batch.plannedCompletionDate } });
            await tx.productionPlanChange.create({ data: { planOrderId: batch.planOrderId, batchId: batch.id,
              action: 'adjust_estimated_completion_date', reason, actorId: actor.id,
              beforeData: { estimatedCompletionDate: before.estimatedCompletionDate },
              afterData: { estimatedCompletionDate: productionDateKey(date), originalWeekUnchanged: true } } });
          }
        } else throw new ProductionControlError('请选择客户交期或内部预计完成日');
      }
      const updated = await tx.workOrder.update({ where: { id: root.id }, data });
      await tx.productionControlEvent.create({ data: {
        workOrderId: root.id, action, reason: reason || null, actorId: actor.id, actorName, requestId, requestHash,
        beforeData: snapshot(before), afterData: snapshot({ ...serializeProductionControl(updated), impact }),
      } });
      return root.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });
    return getProductionControl(actor, rootId);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (['P2034', 'P2002'].includes(error.code)
      || (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code))))) {
      const replay = await prisma.productionControlEvent.findUnique({ where: { requestId } });
      if (replay?.actorId === actor.id && replay.requestHash === requestHash) return getProductionControl(actor, replay.workOrderId);
      throw new ProductionControlError('生产数据正在被其他流程更新，请刷新后重试', 'PRODUCTION_CONTROL_VERSION_CONFLICT', 409);
    }
    throw error;
  }
}
