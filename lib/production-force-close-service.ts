import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { assertProductionScopeRead, assertProductionScopeWrite, resolveProductionEntityScope } from '@/lib/production-access-scope';
import { canManageProductionControl, ProductionControlError } from '@/lib/production-control';
import type { ProductionControlActor } from '@/lib/production-control-service';
import { productionWorkOrderScopeWhere } from '@/lib/production-execution';
import { isProductionSerializationConflict } from '@/lib/production-pause-guard';
import { lockProductionWorkOrder } from '@/lib/production-work-order-lock';
import { getProductionQuantitySummary } from '@/lib/production-quantity';
import { processSupplementRemainingQty } from '@/lib/process-supplement-coverage';
import { isExecutableProductionWorkOrder, legacyStatusForStage, normalizeWorkOrderStage } from '@/lib/work-orders';
import {
  PRODUCTION_FORCE_CLOSE_EVENT,
  PRODUCTION_FORCE_CLOSE_ROUTE_STATUS,
  type ProductionForceCloseMode,
  type ProductionForceClosePreview,
} from '@/lib/production-force-close';

type ForceCloseInput = {
  mode?: unknown;
  actualQty?: unknown;
  reason?: unknown;
  version?: unknown;
  requestId?: unknown;
};

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function visibleOrder(tx: Prisma.TransactionClient, actor: ProductionControlActor, id: string, write = false) {
  const scope = resolveProductionEntityScope(actor);
  if (write) {
    assertProductionScopeWrite(scope);
    if (!canManageProductionControl(actor)) {
      throw new ProductionControlError('当前账号没有该工单的生产管理权限', 'PRODUCTION_FORCE_CLOSE_FORBIDDEN', 403);
    }
  } else {
    assertProductionScopeRead(scope);
  }
  const order = await tx.workOrder.findFirst({
    where: { id, deletedAt: null, ...productionWorkOrderScopeWhere(scope) },
  });
  if (!order) throw new ProductionControlError('工单不存在或不在可见范围内', 'WORK_ORDER_NOT_FOUND', 404);
  return order;
}

function isOpen(order: Awaited<ReturnType<typeof visibleOrder>>) {
  return !order.forceClosedAt && !order.completedAt
    && normalizeWorkOrderStage(order.stage || order.status) !== 'completed'
    && isExecutableProductionWorkOrder(order);
}

async function loadPreview(
  tx: Prisma.TransactionClient,
  actor: ProductionControlActor,
  order: Awaited<ReturnType<typeof visibleOrder>>,
): Promise<ProductionForceClosePreview> {
  const [route, branches, pendingSubmissionCount, event] = await Promise.all([
    tx.workOrderProcessRoute.findUnique({
      where: { workOrderId: order.id },
      select: {
        id: true, version: true, status: true,
        steps: {
          where: { retiredAt: null },
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          select: {
            id: true, position: true, processName: true, status: true, executionMode: true,
            supplementObligation: { select: { status: true, requiredQty: true, systemCoveredQty: true, reportedQty: true, fulfillmentMode: true } },
          },
        },
      },
    }),
    tx.workOrder.findMany({
      where: {
        OR: [{ parentWorkOrderId: order.id }, { rootWorkOrderId: order.id }],
        deletedAt: null, completedAt: null, branchStatus: { notIn: ['RESOLVED', 'CANCELLED'] },
      },
      orderBy: { id: 'asc' },
      select: { code: true, businessCode: true },
    }),
    tx.processReportSubmission.count({ where: { workOrderId: order.id, status: 'PENDING' } }),
    order.forceClosedAt
      ? tx.productionControlEvent.findFirst({
        where: { workOrderId: order.id, action: PRODUCTION_FORCE_CLOSE_EVENT },
        orderBy: { createdAt: 'desc' },
      })
      : null,
  ]);
  const reports = route ? await tx.processCompletion.groupBy({
    by: ['stepId', 'coverageStatus'],
    where: { routeId: route.id, voidedAt: null, step: { retiredAt: null } },
    _sum: { processedQty: true, coveredQty: true },
  }) : [];
  const reportsByStep = new Map<string, { reported: number; covered: number }>();
  for (const report of reports) {
    const previous = reportsByStep.get(report.stepId) || { reported: 0, covered: 0 };
    const reported = report._sum.processedQty || 0;
    reportsByStep.set(report.stepId, {
      reported: previous.reported + reported,
      covered: previous.covered + (report.coverageStatus === 'COVERED' ? reported : report._sum.coveredQty || 0),
    });
  }
  const steps = (route?.steps || []).map(step => {
    const counts = reportsByStep.get(step.id);
    const reported = counts?.reported || 0;
    const covered = counts?.covered || 0;
    const obligation = step.supplementObligation;
    return {
      id: step.id,
      name: step.processName,
      position: step.position,
      status: step.status,
      reported,
      covered,
      pendingCoverage: Math.max(0, reported - covered),
      supplementalRemaining: obligation?.status === 'ACTIVE'
        ? processSupplementRemainingQty(obligation)
        : 0,
    };
  });
  const lastStep = route?.steps.filter(step => step.executionMode !== 'SUPPLEMENTAL_OBLIGATION').at(-1);
  const lastReportedQty = lastStep ? reportsByStep.get(lastStep.id)?.reported ?? 0 : null;
  const quantity = getProductionQuantitySummary(order);
  const relatedOpenOrders = branches.map(branch => branch.businessCode || branch.code);
  const details = event?.afterData as { mode?: ProductionForceCloseMode } | null;
  const result: ProductionForceClosePreview = {
    workOrderId: order.id,
    code: order.businessCode || order.code,
    specification: order.specification,
    targetQty: quantity.targetQty,
    verifiedQty: quantity.completedQty,
    lastReportedQty,
    steps,
    relatedOpenOrders,
    pendingSubmissionCount,
    version: digest({
      id: order.id, executionVersion: order.executionVersion, controlVersion: order.productionControlVersion,
      routeVersion: route?.version, routeStatus: route?.status, quantity, steps, relatedOpenOrders, pendingSubmissionCount,
    }),
    closure: order.forceClosedAt ? {
      mode: details?.mode === 'verified_output' ? 'verified_output' : 'stop_execution',
      actualQty: order.forceClosedQty,
      reason: event?.reason || '',
      actor: event?.actorName || '',
      at: order.forceClosedAt.toISOString(),
    } : null,
    canClose: isOpen(order) && canManageProductionControl(actor) && resolveProductionEntityScope(actor).canWrite,
  };
  if (event && result.closure) {
    const original = event.beforeData as unknown as ProductionForceClosePreview;
    return { ...original, closure: result.closure, canClose: false };
  }
  return result;
}

export async function previewProductionForceClose(actor: ProductionControlActor, workOrderId: string) {
  return prisma.$transaction(async tx => {
    const order = await visibleOrder(tx, actor, workOrderId);
    return loadPreview(tx, actor, order);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

function parseInput(input: ForceCloseInput) {
  const { mode } = input;
  if (mode !== 'verified_output' && mode !== 'stop_execution') {
    throw new ProductionControlError('请选择现场已完工或停止执行');
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason || reason.length > 500) throw new ProductionControlError('请填写结单原因（最多 500 字）');
  const actualQty = input.actualQty ?? null;
  if (actualQty === null ? mode === 'verified_output' : (
    typeof actualQty !== 'number' || !Number.isInteger(actualQty) || actualQty < 0 || actualQty > 2147483647
  )) {
    throw new ProductionControlError('请填写有效的实际完成数量');
  }
  if (typeof input.version !== 'string' || !/^[a-f\d]{64}$/.test(input.version)
    || typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(input.requestId)) {
    throw new ProductionControlError('结单预览已失效，请刷新后重试');
  }
  return { mode: mode as ProductionForceCloseMode, actualQty: actualQty as number | null,
    reason, version: input.version, requestId: `force-close:${input.requestId}` };
}

export async function closeProductionByException(actor: ProductionControlActor, workOrderId: string, input: ForceCloseInput) {
  const command = parseInput(input);
  const requestHash = digest({ actor: actor.id, workOrderId, command });
  const actorName = actor.displayName || actor.username;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(async tx => {
        await visibleOrder(tx, actor, workOrderId, true);
        await lockProductionWorkOrder(tx, workOrderId);
        const order = await visibleOrder(tx, actor, workOrderId, true);
        const replay = await tx.productionControlEvent.findUnique({ where: { requestId: command.requestId } });
        if (replay) {
          if (replay.requestHash !== requestHash || replay.action !== PRODUCTION_FORCE_CLOSE_EVENT) {
            throw new ProductionControlError('本次结单标识已被使用，请重新打开结单预览', 'PRODUCTION_FORCE_CLOSE_REPLAY', 409);
          }
          return loadPreview(tx, actor, order);
        }
        if (!isOpen(order)) throw new ProductionControlError('工单已结单或已归档', 'PRODUCTION_FORCE_CLOSE_NOT_OPEN', 409);
        const preview = await loadPreview(tx, actor, order);
        if (preview.version !== command.version) {
          throw new ProductionControlError('结单预览后工单已有新进展，请刷新并重新核对', 'PRODUCTION_FORCE_CLOSE_STALE', 409);
        }

        const now = new Date();
        const updated = await tx.workOrder.update({
          where: { id: workOrderId },
          data: {
            stage: 'completed',
            status: legacyStatusForStage('completed'),
            completedAt: now,
            lastProgressAt: now,
            forceClosedAt: now,
            forceClosedQty: command.actualQty,
            executionVersion: { increment: 1 },
            productionControlVersion: { increment: 1 },
          },
        });
        const route = await tx.workOrderProcessRoute.findUnique({ where: { workOrderId }, select: { id: true } });
        if (route) {
          await tx.workOrderProcessRoute.update({
            where: { id: route.id },
            data: { status: PRODUCTION_FORCE_CLOSE_ROUTE_STATUS, version: { increment: 1 } },
          });
          await tx.processRouteActivity.create({
            data: { routeId: route.id, action: PRODUCTION_FORCE_CLOSE_EVENT, content: `强制结单：${command.reason}`, actorId: actor.id },
          });
        }
        const tasks = await tx.dailyProcessTask.updateMany({
          where: { workOrderId, status: { notIn: ['COMPLETED', 'CARRIED_OVER', 'CANCELLED'] } },
          data: { productionSuspendedAt: now, version: { increment: 1 } },
        });
        await tx.productionControlEvent.create({
          data: {
            workOrderId, action: PRODUCTION_FORCE_CLOSE_EVENT, reason: command.reason, actorId: actor.id, actorName,
            requestId: command.requestId, requestHash,
            beforeData: { ...preview, stage: order.stage, completedQty: order.completedQty },
            afterData: {
              mode: command.mode, actualQty: command.actualQty, closedAt: now.toISOString(),
              suspendedTaskCount: tasks.count,
            },
          },
        });
        return {
          ...preview,
          canClose: false,
          closure: { mode: command.mode, actualQty: updated.forceClosedQty, reason: command.reason, actor: actorName, at: now.toISOString() },
        } satisfies ProductionForceClosePreview;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!isProductionSerializationConflict(error)) throw error;
      if (attempt >= 2) {
        throw new ProductionControlError('该工单有其他操作正在提交，请刷新后再试', 'PRODUCTION_FORCE_CLOSE_STALE', 409);
      }
    }
  }
}
