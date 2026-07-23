import { Prisma, type WorkOrder } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export class WorkOrderDeletionServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = 'WORK_ORDER_DELETE_INVALID') {
    super(message);
    this.name = 'WorkOrderDeletionServiceError';
    this.status = status;
    this.code = code;
  }
}

export type WorkOrderDeletionGuardState = {
  isBranch: boolean;
  hasActiveDescendants: boolean;
  routeStatus: string | null;
  completionCount: number;
  movementCount: number;
  laborPoolCount: number;
};

export function workOrderDeletionLockReason(
  state: WorkOrderDeletionGuardState,
): string | null {
  if (state.isBranch) return '分支工单不能通过通用删除入口移除，请通过专用分支闭环流程处理';
  if (state.hasActiveDescendants) return '工单仍有未闭环分支，不能删除';
  if (state.routeStatus && state.routeStatus !== 'draft') {
    return '工单工艺路线已确认或进入生产，不能通过通用删除入口移除';
  }
  if (state.completionCount > 0 || state.movementCount > 0 || state.laborPoolCount > 0) {
    return '工单已产生生产数量或工时账本，不能删除';
  }
  return null;
}

async function hasActiveDescendants(
  tx: Prisma.TransactionClient,
  workOrderId: string,
): Promise<boolean> {
  let frontier = [workOrderId];
  const visited = new Set(frontier);
  while (frontier.length) {
    const children = await tx.workOrder.findMany({
      where: {
        parentWorkOrderId: { in: frontier },
        deletedAt: null,
      },
      select: {
        id: true,
        branchStatus: true,
      },
    });
    if (children.some(child => (
      child.branchStatus !== 'RESOLVED' && child.branchStatus !== 'CANCELLED'
    ))) {
      return true;
    }
    const next: string[] = [];
    for (const child of children) {
      if (visited.has(child.id)) {
        throw new WorkOrderDeletionServiceError(
          '工单分支层级存在循环，不能删除',
          409,
          'WORK_ORDER_BRANCH_ANCESTRY_CYCLE',
        );
      }
      visited.add(child.id);
      next.push(child.id);
    }
    frontier = next;
  }
  return false;
}

export async function softDeleteWorkOrderWithProductionGuard(input: {
  workOrderId: string;
  confirmText: unknown;
}): Promise<{ before: WorkOrder; after: WorkOrder }> {
  try {
    return await prisma.$transaction(async tx => {
      const old = await tx.workOrder.findFirst({
        where: { id: input.workOrderId, deletedAt: null },
      });
      if (!old) {
        throw new WorkOrderDeletionServiceError('工单不存在', 404, 'WORK_ORDER_NOT_FOUND');
      }
      const expected = `${old.code} CONFIRM`;
      const confirmText = String(input.confirmText || '').trim().replace(/\s+/g, ' ');
      if (confirmText !== expected) {
        throw new WorkOrderDeletionServiceError(
          '删除确认不匹配',
          400,
          'WORK_ORDER_DELETE_CONFIRMATION_MISMATCH',
        );
      }

      const [
        hasActiveChild,
        route,
        completionCount,
        movementCount,
        laborPoolCount,
      ] = await Promise.all([
        hasActiveDescendants(tx, old.id),
        tx.workOrderProcessRoute.findUnique({
          where: { workOrderId: old.id },
          select: { status: true },
        }),
        tx.processCompletion.count({ where: { workOrderId: old.id } }),
        tx.processQuantityMovement.count({
          where: {
            OR: [
              { workOrderId: old.id },
              { branchWorkOrderId: old.id },
            ],
          },
        }),
        tx.processLaborPool.count({ where: { workOrderId: old.id } }),
      ]);
      const lockReason = workOrderDeletionLockReason({
        isBranch: Boolean(old.parentWorkOrderId),
        hasActiveDescendants: hasActiveChild,
        routeStatus: route?.status || null,
        completionCount,
        movementCount,
        laborPoolCount,
      });
      if (lockReason) {
        throw new WorkOrderDeletionServiceError(
          lockReason,
          409,
          'WORK_ORDER_PRODUCTION_LEDGER_LOCKED',
        );
      }

      const now = new Date();
      const updated = await tx.workOrder.updateMany({
        where: { id: old.id, deletedAt: null },
        data: { deletedAt: now },
      });
      if (updated.count !== 1) {
        throw new WorkOrderDeletionServiceError(
          '工单状态已变化，请刷新后重试',
          409,
          'WORK_ORDER_DELETE_CONFLICT',
        );
      }
      const after = await tx.workOrder.findUniqueOrThrow({ where: { id: old.id } });
      return { before: old, after };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof WorkOrderDeletionServiceError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      throw new WorkOrderDeletionServiceError(
        '工单状态已变化，请刷新后重试',
        409,
        'WORK_ORDER_DELETE_CONFLICT',
      );
    }
    throw error;
  }
}
