import {
  Prisma,
  WipRequirementStatus,
  WipWeekAllocationStatus,
} from '@prisma/client';
import { WipWarehouseError, refreshWipLotStatus } from '@/lib/wip-warehouse';
import { wipEntryCheckpointClosesRoute } from '@/lib/wip-completion-checkpoint';
import { pendingProcessReportReservations } from '@/lib/process-report-reservations';
import { chinaTodayDateKey, dateKeyFromDatabase } from '@/lib/attendance';
import { chinaWeekRange } from '@/lib/production-planning';

/** Internal recovery-only authorization. Never read this value from a reporting HTTP body. */
export type HistoricalWipReportingAuthorization = {
  actorId: string; submissionId: string; allocationId: string; expectedVersion: number; workDateKey: string;
};

/** Built only by the locked pending-submission recovery transaction, never by HTTP parsing. */
export type WipRecoverySources = {
  submissionId: string;
  parts: Array<{ allocationId: string; quantity: number; historical?: HistoricalWipReportingAuthorization }>;
};

export type WipReportingResolution = {
  allocationId: string;
  allocationStepId: string;
  lotId: string;
  lotNo: string;
  creditQuantity: number;
  remainingAllocationQuantity: number;
  parts?: Array<NonNullable<WipReportingResolution>>;
} | null;

export function resolveWipNativeSourceReportLimits(input: {
  reportableQty: number;
  outstandingWipQuantity: number;
  reportableUnitQty?: number | null;
  unitsPerProduct?: number | null;
}): {
  nativeReportableQty: number;
  nativeReportableUnitQty: number | null;
} {
  const reportableQty = Math.max(0, Math.trunc(input.reportableQty));
  const outstandingWipQuantity = Math.max(0, Math.trunc(input.outstandingWipQuantity));
  const nativeReportableQty = Math.max(0, reportableQty - outstandingWipQuantity);
  if (input.reportableUnitQty === null || input.reportableUnitQty === undefined) {
    return { nativeReportableQty, nativeReportableUnitQty: null };
  }
  const reportableUnitQty = Math.max(0, Math.trunc(input.reportableUnitQty));
  const unitsPerProduct = Math.max(1, Math.trunc(input.unitsPerProduct || 1));
  return {
    nativeReportableQty,
    nativeReportableUnitQty: Math.max(
      0,
      reportableUnitQty - outstandingWipQuantity * unitsPerProduct,
    ),
  };
}

export async function resolveWipReportingAllocation(
  tx: Prisma.TransactionClient,
  input: {
    workOrderId: string;
    stepId: string;
    workDate: Date;
    /** Good product quantity eligible for a WIP completion credit. */
    processedQty: number;
    /** Total product quantity submitted by an ordinary/source reporting form. */
    reportedProductQty?: number;
    /** Good action quantity for action-basis steps. */
    reportedGoodUnitQty?: number;
    reportableQty: number;
    reportableUnitQty?: number;
    unitsPerProduct?: number;
    requestedAllocationId?: string | null;
    excludeSubmissionId?: string;
    historicalAuthorization?: HistoricalWipReportingAuthorization;
    recoverySources?: WipRecoverySources;
  },
): Promise<WipReportingResolution> {
  if (input.recoverySources) {
    const { submissionId, parts } = input.recoverySources;
    const submission = await tx.processReportSubmission.findFirst({ where: { id: submissionId, status: 'PENDING', completionId: null,
      workOrderId: input.workOrderId, stepId: input.stepId, workDate: input.workDate }, select: { id: true } });
    if (!submission || submissionId !== input.excludeSubmissionId || parts.length < 2 || parts.length > 30
      || new Set(parts.map(part => part.allocationId)).size !== parts.length
      || parts.some(part => !Number.isSafeInteger(part.quantity) || part.quantity <= 0)
      || parts.reduce((sum, part) => sum + part.quantity, 0) !== input.processedQty) {
      throw new WipWarehouseError('原申报数量与合并来源不一致，请刷新重新核对', 'WIP_RECOVERY_SOURCES_INVALID', 409);
    }
    const resolutions: Array<NonNullable<WipReportingResolution>> = [];
    for (const part of parts) {
      const resolution = await resolveWipReportingAllocation(tx, { ...input, recoverySources: undefined,
        processedQty: part.quantity, reportedProductQty: part.quantity, requestedAllocationId: part.allocationId,
        historicalAuthorization: part.historical });
      if (!resolution) throw new WipWarehouseError('合并来源已失效，请刷新预览', 'WIP_ALLOCATION_CHANGED', 409);
      resolutions.push(resolution);
    }
    return { ...resolutions[0], creditQuantity: input.processedQty, parts: resolutions };
  }
  const reportedProductQty = Math.max(0, input.reportedProductQty ?? input.processedQty);
  const reportedGoodUnitQty = Math.max(0, input.reportedGoodUnitQty || 0);
  if (reportedProductQty <= 0 && reportedGoodUnitQty <= 0) return null;
  const lotSteps = await tx.semiFinishedLotStep.findMany({
    where: {
      stepId: input.stepId,
      lot: {
        workOrderId: input.workOrderId,
        scheduleStatus: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      status: { notIn: [WipRequirementStatus.COMPLETED, WipRequirementStatus.CANCELLED] },
    },
    select: {
      id: true,
      remainingQty: true,
      lot: { select: { id: true, lotNo: true, containerCode: true, enteredAt: true } },
      allocationSteps: {
        where: { status: { not: 'CANCELLED' } },
        select: {
          id: true,
          plannedQty: true,
          completedQty: true,
          allocation: {
            select: {
              id: true,
              status: true,
              version: true,
              targetWeekStartDate: true,
              targetWeekEndDate: true,
            },
          },
          credits: { where: { status: 'ACTIVE' }, select: { quantity: true } },
        },
      },
    },
  });
  if (!lotSteps.length) return null;

  const historical = input.historicalAuthorization;
  if (historical) {
    const submission = await tx.processReportSubmission.findFirst({ where: {
      id: historical.submissionId, status: 'PENDING', completionId: null,
      workOrderId: input.workOrderId, stepId: input.stepId, workDate: input.workDate,
    }, select: { id: true } });
    const selectedLot = lotSteps.find(step => step.allocationSteps.some(allocationStep => allocationStep.allocation.id === historical.allocationId));
    const allocation = selectedLot?.allocationSteps.find(step => step.allocation.id === historical.allocationId)?.allocation;
    if (!submission || historical.submissionId !== input.excludeSubmissionId || historical.allocationId !== input.requestedAllocationId
      || historical.workDateKey !== dateKeyFromDatabase(input.workDate) || !selectedLot || !allocation
      || allocation.version !== historical.expectedVersion || historical.workDateKey >= chinaTodayDateKey(chinaWeekRange(new Date()).start)
      || input.workDate >= allocation.targetWeekStartDate || chinaTodayDateKey(selectedLot.lot.enteredAt) > historical.workDateKey) {
      throw new WipWarehouseError('历史作业确认条件已变化，需核对真实日期、入仓日期及当前排程余额', 'WIP_HISTORICAL_CONFIRMATION_INVALID', 409);
    }
  }

  let outstandingWipQuantity = 0;
  const currentOptions: Array<{
    allocationId: string;
    allocationStepId: string;
    lotId: string;
    lotNo: string;
    remaining: number;
  }> = [];
  for (const lotStep of lotSteps) {
    const credited = lotStep.allocationSteps.reduce((sum, allocationStep) => (
      sum + allocationStep.credits.reduce((creditSum, credit) => creditSum + credit.quantity, 0)
    ), 0);
    outstandingWipQuantity += Math.max(0, lotStep.remainingQty - credited);
    for (const allocationStep of lotStep.allocationSteps) {
      if (
        allocationStep.allocation.status !== WipWeekAllocationStatus.ACTIVE
        && allocationStep.allocation.status !== WipWeekAllocationStatus.IN_PROGRESS
      ) continue;
      const remaining = Math.max(0, allocationStep.plannedQty - allocationStep.completedQty);
      if (
        remaining > 0
        && ((allocationStep.allocation.targetWeekStartDate <= input.workDate
        && allocationStep.allocation.targetWeekEndDate >= input.workDate)
        || historical?.allocationId === allocationStep.allocation.id)
      ) {
        currentOptions.push({
          allocationId: allocationStep.allocation.id,
          allocationStepId: allocationStep.id,
          lotId: lotStep.lot.id,
          lotNo: lotStep.lot.lotNo,
          remaining,
        });
      }
    }
  }

  const pending = await pendingProcessReportReservations(tx, input.stepId, input.excludeSubmissionId);
  // The caller's global limit already excludes pending product reservations. WIP pending
  // quantities must also leave outstanding inventory here, otherwise native is reduced twice.
  const pendingWip = pending.rows.filter(row => row.sourceKind === 'WIP')
    .reduce((sum, row) => sum + row.reservedProductQty, 0);
  const nativeLimits = resolveWipNativeSourceReportLimits({
    reportableQty: input.reportableQty,
    outstandingWipQuantity: Math.max(0, outstandingWipQuantity - pendingWip),
    reportableUnitQty: input.reportableUnitQty,
    unitsPerProduct: input.unitsPerProduct,
  });
  const requestedAllocationId = String(input.requestedAllocationId || '').trim();
  if (requestedAllocationId) {
    const selected = currentOptions.find(option => option.allocationId === requestedAllocationId);
    if (!selected) {
      throw new WipWarehouseError(
        '所选半成品排程不属于该工序或不在本次生产日期所在周',
        'WIP_ALLOCATION_NOT_REPORTABLE',
        409,
      );
    }
    const reserved = pending.rows.filter(row => row.sourceAllocationId === selected.allocationId
      || (!row.sourceAllocationId && row.sourceLotId === selected.lotId))
      .reduce((sum, row) => sum + row.reservedProductQty, 0);
    selected.remaining = Math.max(0, selected.remaining - reserved);
    if (input.processedQty > selected.remaining) {
      throw new WipWarehouseError(
        `本次半成品报工不能超过该排程剩余数量 ${selected.remaining}`,
        'WIP_REPORT_EXCEEDS_ALLOCATION',
        409,
      );
    }
    if (input.processedQty <= 0) return null;
    return { ...selected, creditQuantity: input.processedQty, remainingAllocationQuantity: selected.remaining };
  }
  const exceedsNativeProduct = reportedProductQty > nativeLimits.nativeReportableQty;
  const exceedsNativeAction = nativeLimits.nativeReportableUnitQty !== null
    && reportedGoodUnitQty > nativeLimits.nativeReportableUnitQty;
  if (exceedsNativeProduct || exceedsNativeAction) {
    const nativeActionText = nativeLimits.nativeReportableUnitQty === null
      ? ''
      : `，合格动作最多 ${nativeLimits.nativeReportableUnitQty}`;
    throw new WipWarehouseError(
      `普通来源报工不能消耗已转入半成品仓的数量；当前来源最多可报 ${nativeLimits.nativeReportableQty} 件${nativeActionText}。半成品部分请从紫色续作行或明确选择半成品排程报工`,
      'WIP_SOURCE_REPORT_EXCEEDS_NATIVE',
      409,
    );
  }
  // A request without an allocation id is always the native/source ledger.
  // WIP may only be consumed through an explicitly selected continuation so a
  // stale source row can never silently claim target-week inventory.
  return null;
}

function proportionalCredit(milliseconds: bigint, quantity: number, totalQuantity: number): bigint {
  if (milliseconds <= 0n || quantity <= 0 || totalQuantity <= 0) return 0n;
  if (quantity >= totalQuantity) return milliseconds;
  return milliseconds * BigInt(quantity) / BigInt(totalQuantity);
}

export async function recomputeAllocationAndLot(
  tx: Prisma.TransactionClient,
  allocationId: string,
  lotId: string,
): Promise<void> {
  const allocation = await tx.wipWeekAllocation.findUnique({
    where: { id: allocationId },
    include: {
      steps: {
        include: { lotStep: { select: { position: true } } },
        orderBy: { lotStep: { position: 'asc' } },
      },
    },
  });
  if (!allocation) return;
  if (allocation.status === WipWeekAllocationStatus.CANCELLED) return;
  const activeSteps = allocation.steps.filter(step => step.status !== WipRequirementStatus.CANCELLED);
  const completedMilliseconds = activeSteps.reduce(
    (sum, step) => sum + step.completedStandardMilliseconds,
    0n,
  );
  // Every requirement (including parallel and supplemental operations) must
  // cover this slice. Display position is not a physical completion endpoint.
  const order = !activeSteps.length ? await tx.semiFinishedLot.findUniqueOrThrow({ where: { id: lotId },
    select: { completedStepIds: true, route: { select: { steps: { where: { retiredAt: null, status: { not: 'skipped' } }, select: { id: true } } } },
      workOrder: { select: { stage: true, completedQty: true, productionTargetQty: true } } } }) : null;
  const canonicalClosed = Boolean(order && (wipEntryCheckpointClosesRoute({ completedStepIds: order.completedStepIds,
    liveStepIds: order.route.steps.map(step => step.id) }) || order.workOrder.stage === 'completed'
    && Number(order.workOrder.completedQty) >= (order.workOrder.productionTargetQty || 1)));
  const completedQty = activeSteps.length
    ? Math.max(0, Math.min(allocation.quantity, ...activeSteps.map(step => allocation.quantity - step.plannedQty + step.completedQty)))
    : canonicalClosed ? allocation.quantity : 0;
  const allCompleted = completedQty >= allocation.quantity;
  const hasProgress = activeSteps.some(step => step.completedQty > 0);
  const status = allocation.status === WipWeekAllocationStatus.SUPERSEDED
    ? WipWeekAllocationStatus.SUPERSEDED
    : allCompleted
      ? WipWeekAllocationStatus.COMPLETED
      : hasProgress
        ? WipWeekAllocationStatus.IN_PROGRESS
        : WipWeekAllocationStatus.ACTIVE;
  await tx.wipWeekAllocation.update({
    where: { id: allocation.id },
    data: {
      completedQty,
      completedStandardMilliseconds: completedMilliseconds,
      plannedStandardMilliseconds: activeSteps.reduce((sum, step) => sum + step.plannedStandardMilliseconds, 0n),
      status,
      startedAt: hasProgress ? allocation.startedAt || new Date() : null,
      completedAt: allCompleted ? allocation.completedAt || new Date() : null,
      version: { increment: 1 },
    },
  });
  await refreshWipLotStatus(tx, lotId);
}

export async function recomputeLotStep(tx: Prisma.TransactionClient, lotStepId: string): Promise<void> {
  const lotStep = await tx.semiFinishedLotStep.findUnique({
    where: { id: lotStepId },
    select: {
      remainingQty: true,
      status: true,
      allocationSteps: {
        where: { status: { not: 'CANCELLED' } },
        select: { plannedQty: true, allocation: { select: { status: true, completedQty: true } }, credits: { where: { status: 'ACTIVE' }, select: { quantity: true } } },
      },
    },
  });
  if (!lotStep || lotStep.status === WipRequirementStatus.CANCELLED) return;
  const completed = lotStep.allocationSteps.reduce((sum, allocationStep) => (
    sum + allocationStep.credits.reduce((creditSum, credit) => creditSum + credit.quantity, 0)
  ), 0);
  const status = completed >= lotStep.remainingQty
    ? WipRequirementStatus.COMPLETED
    : completed > 0
      ? WipRequirementStatus.IN_PROGRESS
      : lotStep.allocationSteps.some(step => ['ACTIVE', 'IN_PROGRESS'].includes(step.allocation.status))
        ? WipRequirementStatus.SCHEDULED : WipRequirementStatus.UNSCHEDULED;
  await tx.semiFinishedLotStep.update({ where: { id: lotStepId }, data: { status } });
}

export async function creditWipCompletion(
  tx: Prisma.TransactionClient,
  input: {
    resolution: WipReportingResolution;
    completionId: string;
    workDate: Date;
    idempotencyKey: string;
  },
): Promise<void> {
  if (!input.resolution) return;
  if (input.resolution.parts) {
    for (const part of input.resolution.parts) await creditWipCompletion(tx, { ...input, resolution: part,
      idempotencyKey: `${input.idempotencyKey}:${part.allocationId}` });
    return;
  }
  const allocationStep = await tx.wipWeekAllocationStep.findUnique({
    where: { id: input.resolution.allocationStepId },
    select: {
      id: true,
      lotStepId: true,
      plannedQty: true,
      completedQty: true,
      plannedStandardMilliseconds: true,
      completedStandardMilliseconds: true,
      status: true,
      allocation: { select: { id: true, lotId: true, status: true } },
    },
  });
  if (!allocationStep || allocationStep.status === 'CANCELLED' || !['ACTIVE', 'IN_PROGRESS'].includes(allocationStep.allocation.status)) {
    throw new WipWarehouseError('半成品排程已变化，请刷新后重试', 'WIP_ALLOCATION_CHANGED', 409);
  }
  const remainingQty = Math.max(0, allocationStep.plannedQty - allocationStep.completedQty);
  if (input.resolution.creditQuantity > remainingQty) {
    throw new WipWarehouseError('半成品排程剩余数量已变化，请刷新后重试', 'WIP_ALLOCATION_CHANGED', 409);
  }
  const remainingMilliseconds = allocationStep.plannedStandardMilliseconds
    - allocationStep.completedStandardMilliseconds;
  const standardMilliseconds = proportionalCredit(
    remainingMilliseconds,
    input.resolution.creditQuantity,
    remainingQty,
  );
  await tx.processWipCredit.create({
    data: {
      completionId: input.completionId,
      allocationStepId: allocationStep.id,
      quantity: input.resolution.creditQuantity,
      standardMilliseconds,
      workDate: input.workDate,
      idempotencyKey: `wip-credit:${input.idempotencyKey}`,
    },
  });
  const nextCompletedQty = allocationStep.completedQty + input.resolution.creditQuantity;
  const nextCompletedMilliseconds = allocationStep.completedStandardMilliseconds + standardMilliseconds;
  await tx.wipWeekAllocationStep.update({
    where: { id: allocationStep.id },
    data: {
      completedQty: nextCompletedQty,
      completedStandardMilliseconds: nextCompletedMilliseconds,
      status: nextCompletedQty >= allocationStep.plannedQty
        ? WipRequirementStatus.COMPLETED
        : WipRequirementStatus.IN_PROGRESS,
    },
  });
  await recomputeLotStep(tx, allocationStep.lotStepId);
  await recomputeAllocationAndLot(tx, allocationStep.allocation.id, allocationStep.allocation.lotId);
}

export async function voidWipCreditsForCompletion(
  tx: Prisma.TransactionClient,
  completionId: string,
  now = new Date(),
): Promise<void> {
  const credits = await tx.processWipCredit.findMany({
    where: { completionId, status: 'ACTIVE' },
    select: {
      id: true,
      quantity: true,
      standardMilliseconds: true,
      allocationStep: {
        select: {
          id: true,
          lotStepId: true,
          completedQty: true,
          completedStandardMilliseconds: true,
          status: true,
          allocation: { select: { id: true, lotId: true } },
        },
      },
    },
  });
  for (const credit of credits) {
    await tx.processWipCredit.update({
      where: { id: credit.id },
      data: { status: 'VOIDED', voidedAt: now },
    });
    await tx.wipWeekAllocationStep.update({
      where: { id: credit.allocationStep.id },
      data: {
        completedQty: Math.max(0, credit.allocationStep.completedQty - credit.quantity),
        completedStandardMilliseconds: credit.allocationStep.completedStandardMilliseconds > credit.standardMilliseconds
          ? credit.allocationStep.completedStandardMilliseconds - credit.standardMilliseconds
          : 0n,
        status: credit.allocationStep.status === WipRequirementStatus.CANCELLED
          ? WipRequirementStatus.CANCELLED : WipRequirementStatus.IN_PROGRESS,
      },
    });
    await recomputeLotStep(tx, credit.allocationStep.lotStepId);
    await recomputeAllocationAndLot(
      tx,
      credit.allocationStep.allocation.id,
      credit.allocationStep.allocation.lotId,
    );
  }
}
