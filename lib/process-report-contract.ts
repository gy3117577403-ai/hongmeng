import { Prisma } from '@prisma/client';
import { productTimeProfileInclude, productTimeStandardSnapshot } from '@/lib/product-time';

export type ProcessReportContract = {
  reportQuantityBasis: string;
  reportUnitLabel: string;
  timeBasis: string | null;
  unitsPerProduct: number;
};

export type ProcessReportContractIssue = { code: string; message: string };

export function processReportContractIssue(contract: ProcessReportContract): ProcessReportContractIssue | null {
  if (!Number.isSafeInteger(contract.unitsPerProduct) || contract.unitsPerProduct < 1
    || (contract.reportQuantityBasis === 'action'
      && (contract.timeBasis !== 'per_unit' || contract.unitsPerProduct <= 1))) {
    return {
      code: 'PROCESS_ACTION_REPORT_STANDARD_INVALID',
      message: '动作报工口径与每套次数或计时方式不一致，需要核对工序标准',
    };
  }
  return null;
}

/** Completed actions are a quantity ledger: changing their conversion to sets is not a time correction. */
export function processReportContractTransitionIssue(
  current: ProcessReportContract,
  incoming: ProcessReportContract,
  hasEffectiveReports: boolean,
): ProcessReportContractIssue | null {
  const invalid = processReportContractIssue(incoming);
  if (invalid) return invalid;
  if (hasEffectiveReports && (current.reportQuantityBasis === 'action' || incoming.reportQuantityBasis === 'action')
    && (processReportContractIssue(current)
      || current.reportQuantityBasis !== incoming.reportQuantityBasis
      || current.timeBasis !== incoming.timeBasis
      || current.unitsPerProduct !== incoming.unitsPerProduct
      || current.reportUnitLabel !== incoming.reportUnitLabel)) {
    return {
      code: 'PROCESS_REPORT_CONTRACT_HISTORY_CONFLICT',
      message: '已有有效报工，不能把历史动作数量改成整套或改变每套动作次数；请保留原数量口径，或核对撤回相关报工后再调整',
    };
  }
  return null;
}

export function completionLaborUnitsPerProduct(reportQuantityBasis: string, unitsPerProduct: number): number {
  return reportQuantityBasis === 'action' ? 1 : unitsPerProduct;
}

export type ProcessStepContractRepairResult = {
  status: 'repaired' | 'unchanged' | 'blocked';
  code: string;
  message: string;
  stepId: string;
  routeVersion?: number;
};

export type ProcessStepContractSnapshot = ProcessReportContract & {
  standardMillisecondsPerUnit: number | null;
  setupMilliseconds: number;
  countsForEfficiency: boolean;
  unitLabel: string | null;
  productTimeProfileId: string | null;
  productTimeEntryId: string | null;
  productTimeProfileVersion: number | null;
};

export async function getProcessStepPublishedContract(
  tx: Prisma.TransactionClient,
  input: { routeId: string; stepId: string },
): Promise<{
  status: 'available' | 'blocked'; code: string; message: string;
  routeVersion: number | null; current: ProcessStepContractSnapshot | null; published: ProcessStepContractSnapshot | null;
}> {
  const step = await tx.workOrderProcessStep.findFirst({
    where: { id: input.stepId, routeId: input.routeId },
    include: {
      productTimeEntry: { select: { occurrenceKey: true } },
      route: { include: { workOrder: { select: { drawingLibraryItemId: true, deletedAt: true } } } },
    },
  });
  const current: ProcessStepContractSnapshot | null = step ? {
    reportQuantityBasis: step.reportQuantityBasis, reportUnitLabel: step.reportUnitLabel,
    timeBasis: step.timeBasis, unitsPerProduct: step.unitsPerProduct,
    standardMillisecondsPerUnit: step.standardMillisecondsPerUnit, setupMilliseconds: step.setupMilliseconds,
    countsForEfficiency: step.countsForEfficiency, unitLabel: step.unitLabel,
    productTimeProfileId: step.productTimeProfileId, productTimeEntryId: step.productTimeEntryId,
    productTimeProfileVersion: step.productTimeProfileVersion,
  } : null;
  const blocked = (code: string, message: string) => ({ status: 'blocked' as const, code, message,
    routeVersion: step?.route.version ?? null, current, published: null });
  if (!step || step.retiredAt || step.executionMode !== 'NORMAL' || step.route.workOrder.deletedAt) {
    return blocked('PROCESS_REPORT_STEP_NOT_ACTIVE', '原工序已失效或不属于普通工序，不能按名称关联');
  }
  const itemId = step.route.workOrder.drawingLibraryItemId;
  const occurrenceKey = step.productTimeEntry?.occurrenceKey;
  if (!itemId || !occurrenceKey) return blocked('PROCESS_REPORT_OCCURRENCE_UNRESOLVED', '缺少稳定的产品工序实例关联');
  const profile = await tx.productTimeProfile.findFirst({
    where: { drawingLibraryItemId: itemId, ...(['product_time_pinned', 'work_order_override'].includes(step.route.routeSource)
      ? { id: step.route.productTimeProfileId || '' } : { status: 'published' }) },
    orderBy: [{ version: 'desc' }, { publishedAt: 'desc' }], include: productTimeProfileInclude,
  });
  const entries = profile?.entries.filter(entry => entry.occurrenceKey === occurrenceKey
    && entry.processDefinitionId === step.processDefinitionId) || [];
  if (!profile || entries.length !== 1) return blocked('PROCESS_REPORT_PUBLISHED_OCCURRENCE_MISSING', '当前发布版本中无法唯一找到原工序');
  const published = productTimeStandardSnapshot(profile, entries[0]);
  return { status: 'available', code: 'PROCESS_REPORT_PUBLISHED_CONTRACT_AVAILABLE', message: '已匹配当前发布工序标准',
    routeVersion: step.route.version, current, published };
}

/** Caller must use a serializable transaction and authorize the actor before invoking this helper.
 * Repairs only the selected live occurrence. Historical reports, material movements and route ordering stay intact.
 */
export async function repairUnreportedProcessStepContract(
  tx: Prisma.TransactionClient,
  input: { routeId: string; stepId: string; actorId: string; expectedRouteVersion?: number },
): Promise<ProcessStepContractRepairResult> {
  const blocked = (code: string, message: string): ProcessStepContractRepairResult => ({
    status: 'blocked', code, message, stepId: input.stepId,
  });
  // The same route row is versioned by reporting and deployment, preventing a repair/report race.
  await tx.$queryRaw`SELECT "id" FROM "work_order_process_routes" WHERE "id" = ${input.routeId} FOR UPDATE`;
  const step = await tx.workOrderProcessStep.findFirst({
    where: { id: input.stepId, routeId: input.routeId },
    include: {
      productTimeEntry: { select: { occurrenceKey: true } },
      route: { include: { workOrder: { select: { id: true, drawingLibraryItemId: true, deletedAt: true, completedAt: true } } } },
    },
  });
  if (!step || step.retiredAt || step.executionMode !== 'NORMAL') {
    return blocked('PROCESS_REPORT_STEP_NOT_ACTIVE', '原工序已失效或属于补充工序，不能按名称自动关联报工');
  }
  if (step.route.workOrder.deletedAt || step.route.completedAt || step.route.workOrder.completedAt
    || ['completed', 'skipped'].includes(step.status)) {
    return blocked('PROCESS_REPORT_ROUTE_CLOSED', '工单或工序已关闭，需要先核对原记录');
  }
  if (input.expectedRouteVersion != null && step.route.version !== input.expectedRouteVersion) {
    return blocked('PROCESS_ROUTE_VERSION_CONFLICT', '工艺路线已变化，请刷新后核对');
  }
  const itemId = step.route.workOrder.drawingLibraryItemId;
  const occurrenceKey = step.productTimeEntry?.occurrenceKey;
  if (!itemId || !occurrenceKey) {
    return blocked('PROCESS_REPORT_OCCURRENCE_UNRESOLVED', '缺少稳定工序实例关联，不能按名称或位置猜测标准');
  }
  const profile = await tx.productTimeProfile.findFirst({
    where: { drawingLibraryItemId: itemId, ...(['product_time_pinned', 'work_order_override'].includes(step.route.routeSource)
      ? { id: step.route.productTimeProfileId || '' } : { status: 'published' }) },
    orderBy: [{ version: 'desc' }, { publishedAt: 'desc' }],
    include: productTimeProfileInclude,
  });
  const entries = profile?.entries.filter(entry => entry.occurrenceKey === occurrenceKey
    && entry.processDefinitionId === step.processDefinitionId) || [];
  if (!profile || entries.length !== 1) {
    return blocked('PROCESS_REPORT_PUBLISHED_OCCURRENCE_MISSING', '当前已发布版本中无法唯一找到原工序，需核对工艺变更');
  }
  const snapshot = productTimeStandardSnapshot(profile, entries[0]);
  const invalid = processReportContractIssue(snapshot);
  if (invalid) return blocked(invalid.code, invalid.message);
  if (!Number.isSafeInteger(snapshot.standardMillisecondsPerUnit) || snapshot.standardMillisecondsPerUnit <= 0
    || !Number.isSafeInteger(snapshot.setupMilliseconds) || snapshot.setupMilliseconds < 0) {
    return blocked('PROCESS_REPORT_PUBLISHED_STANDARD_MISSING', '已发布工序仍缺少有效标准工时，需要先补齐标准');
  }
  const unchanged = Object.entries(snapshot).every(([key, value]) => step[key as keyof typeof step] === value);
  if (unchanged) return { status: 'unchanged', code: 'PROCESS_REPORT_CONTRACT_CURRENT', message: '当前工序标准已一致', stepId: step.id, routeVersion: step.route.version };
  const [completions, executions, pools, claims, pendingChanges] = await Promise.all([
    tx.processCompletion.count({ where: { stepId: step.id, voidedAt: null } }),
    tx.processExecution.count({ where: { stepId: step.id, voidedAt: null } }),
    tx.processLaborPool.count({ where: { stepId: step.id, status: { not: 'VOIDED' } } }),
    tx.processLaborClaim.count({ where: { pool: { stepId: step.id }, status: 'ACTIVE' } }),
    tx.processRouteChange.count({ where: { routeId: step.routeId, status: { in: ['SUBMITTED', 'APPROVED', 'ACTIVATING'] } } }),
  ]);
  if (pendingChanges) return blocked('PROCESS_REPORT_ROUTE_CHANGE_PENDING', '该工单有待完成的工艺变更，请先核对变更');
  if (completions || executions || pools || claims || step.processedQty || step.goodOutputQty || step.defectOutputQty || step.releasedGoodQty) {
    return blocked('PROCESS_REPORT_CONTRACT_HAS_ACTIVE_FACTS', '该工序仍有有效报工或工时台账，需要核对历史后再处理口径');
  }
  const updated = await tx.workOrderProcessStep.updateMany({
    where: { id: step.id, routeId: step.routeId, retiredAt: null, quantityVersion: step.quantityVersion },
    data: { ...snapshot, quantityVersion: { increment: 1 } },
  });
  if (updated.count !== 1) return blocked('PROCESS_STEP_QUANTITY_CONFLICT', '当前工序数量已变化，请刷新后核对');
  // This row is locked above; a failure must abort the caller's transaction, never commit only half the repair.
  await tx.workOrderProcessRoute.update({ where: { id: step.routeId }, data: { version: { increment: 1 } } });
  await tx.workOrder.update({ where: { id: step.route.workOrder.id }, data: { executionVersion: { increment: 1 } } });
  const routeVersion = step.route.version + 1;
  await tx.operationLog.create({ data: {
    userId: input.actorId,
    action: 'repair_unreported_process_contract',
    targetType: 'work_order_process_step',
    targetId: step.id,
    detail: {
      routeId: step.routeId, workOrderId: step.route.workOrder.id, occurrenceKey,
      routeVersionBefore: step.route.version, routeVersionAfter: routeVersion,
      reason: '无有效报工，按已发布工序实例整体恢复数量与工时口径',
      before: Object.fromEntries(Object.keys(snapshot).map(key => [key, step[key as keyof typeof step]])),
      after: snapshot,
    } as Prisma.InputJsonValue,
  } });
  return { status: 'repaired', code: 'PROCESS_REPORT_CONTRACT_REPAIRED', message: '已按当前发布标准恢复工序报工口径', stepId: step.id, routeVersion };
}
