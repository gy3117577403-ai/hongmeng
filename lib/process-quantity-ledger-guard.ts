import { Prisma } from '@prisma/client';

const processQuantityLedgerRouteSelect = Prisma.validator<Prisma.WorkOrderProcessRouteSelect>()({
  id: true,
  status: true,
  startedAt: true,
  steps: {
    select: {
      inputQty: true,
      processedQty: true,
      goodOutputQty: true,
      defectOutputQty: true,
      releasedGoodQty: true,
    },
  },
  _count: {
    select: {
      completions: {
        where: { voidedAt: null },
      },
    },
  },
});

export type ProcessQuantityLedgerRouteState = Prisma.WorkOrderProcessRouteGetPayload<{
  select: typeof processQuantityLedgerRouteSelect;
}>;

const dedicatedLifecycleFields = [
  'planType',
  'planActive',
  'planClearedAt',
  'planClearedBy',
  'weekStartDate',
  'weekEndDate',
] as const;

const routeOwnedWorkOrderFields = [
  'code',
  'productName',
  'specification',
  'libraryKey',
  'processName',
  'stage',
  'status',
  'progress',
  'completedQty',
  'uncompletedQty',
  'productionTargetQty',
  'frontendTransferredQty',
  'latestProgressRemark',
] as const;

export function genericWorkOrderPatchBlockReason(
  body: Record<string, unknown>,
  productionLedgerExists: boolean,
): string | null {
  if (dedicatedLifecycleFields.some(field => body[field] !== undefined)) {
    return '计划归属、周范围和激活状态只能通过计划中心或周计划专用流程修改';
  }
  if (
    productionLedgerExists
    && routeOwnedWorkOrderFields.some(field => body[field] !== undefined)
  ) {
    return '该工单已启用生产数量账本，产品身份、工序、目标、阶段和完成数量不能在普通编辑中修改';
  }
  return null;
}

export function processQuantityLedgerIsLocked(
  route: ProcessQuantityLedgerRouteState | null,
): boolean {
  if (!route) return false;
  if (route.startedAt || route._count.completions > 0) return true;
  if (route.status !== 'draft' && route.status !== 'confirmed') return true;
  return route.steps.some(step => (
    step.inputQty > 0
    || step.processedQty > 0
    || step.goodOutputQty > 0
    || step.defectOutputQty > 0
    || step.releasedGoodQty > 0
  ));
}

export async function loadProcessQuantityLedgerState(
  tx: Prisma.TransactionClient,
  workOrderId: string,
): Promise<ProcessQuantityLedgerRouteState | null> {
  return tx.workOrderProcessRoute.findUnique({
    where: { workOrderId },
    select: processQuantityLedgerRouteSelect,
  });
}
