import {
  Prisma,
  WipRequirementStatus,
  WipWeekAllocationStatus,
} from '@prisma/client';
import { WipWarehouseError, refreshWipLotStatus } from '@/lib/wip-warehouse';

export type WipReportingResolution = {
  allocationId: string;
  allocationStepId: string;
  lotId: string;
  lotNo: string;
  creditQuantity: number;
  remainingAllocationQuantity: number;
} | null;

export async function resolveWipReportingAllocation(
  tx: Prisma.TransactionClient,
  input: {
    workOrderId: string;
    stepId: string;
    workDate: Date;
    processedQty: number;
    reportableQty: number;
    requestedAllocationId?: string | null;
  },
): Promise<WipReportingResolution> {
  if (input.processedQty <= 0) return null;
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
      lot: { select: { id: true, lotNo: true, containerCode: true } },
      allocationSteps: {
        select: {
          id: true,
          plannedQty: true,
          completedQty: true,
          allocation: {
            select: {
              id: true,
              status: true,
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
        && allocationStep.allocation.targetWeekStartDate <= input.workDate
        && allocationStep.allocation.targetWeekEndDate >= input.workDate
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

  const nonWipReportable = Math.max(0, input.reportableQty - outstandingWipQuantity);
  const requiredWipQuantity = Math.max(0, input.processedQty - nonWipReportable);
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
    if (input.processedQty > selected.remaining) {
      throw new WipWarehouseError(
        `本次半成品报工不能超过该排程剩余数量 ${selected.remaining}`,
        'WIP_REPORT_EXCEEDS_ALLOCATION',
        409,
      );
    }
    return { ...selected, creditQuantity: input.processedQty, remainingAllocationQuantity: selected.remaining };
  }
  if (requiredWipQuantity <= 0) return null;
  if (!currentOptions.length) {
    throw new WipWarehouseError(
      '本次数量包含半成品仓库存，但该工序尚未排入生产日期所在周，请先由主管/组长/管理员/计划安排周次',
      'WIP_NOT_SCHEDULED_FOR_WEEK',
      409,
    );
  }
  if (currentOptions.length > 1) {
    throw new WipWarehouseError(
      '该产品当前周存在多个半成品批次，请扫码容器码或选择半成品排程后再报工',
      'WIP_ALLOCATION_REQUIRED',
      409,
    );
  }
  const selected = currentOptions[0];
  if (requiredWipQuantity > selected.remaining) {
    throw new WipWarehouseError(
      `当前周半成品排程仅剩 ${selected.remaining} 件，本次报工数量超出计划`,
      'WIP_REPORT_EXCEEDS_ALLOCATION',
      409,
    );
  }
  return { ...selected, creditQuantity: requiredWipQuantity, remainingAllocationQuantity: selected.remaining };
}

function proportionalCredit(milliseconds: bigint, quantity: number, totalQuantity: number): bigint {
  if (milliseconds <= 0n || quantity <= 0 || totalQuantity <= 0) return 0n;
  if (quantity >= totalQuantity) return milliseconds;
  return milliseconds * BigInt(quantity) / BigInt(totalQuantity);
}

async function recomputeAllocationAndLot(
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
  const completedMilliseconds = allocation.steps.reduce(
    (sum, step) => sum + step.completedStandardMilliseconds,
    0n,
  );
  const terminalStep = allocation.steps.at(-1);
  const completedQty = terminalStep
    ? Math.min(allocation.quantity, terminalStep.completedQty)
    : 0;
  const allCompleted = allocation.steps.length > 0
    && allocation.steps.every(step => step.completedQty >= step.plannedQty);
  const hasProgress = allocation.steps.some(step => step.completedQty > 0);
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
      status,
      startedAt: hasProgress ? allocation.startedAt || new Date() : null,
      completedAt: allCompleted ? new Date() : null,
      version: { increment: 1 },
    },
  });
  await refreshWipLotStatus(tx, lotId);
}

async function recomputeLotStep(tx: Prisma.TransactionClient, lotStepId: string): Promise<void> {
  const lotStep = await tx.semiFinishedLotStep.findUnique({
    where: { id: lotStepId },
    select: {
      remainingQty: true,
      allocationSteps: {
        select: { credits: { where: { status: 'ACTIVE' }, select: { quantity: true } } },
      },
    },
  });
  if (!lotStep) return;
  const completed = lotStep.allocationSteps.reduce((sum, allocationStep) => (
    sum + allocationStep.credits.reduce((creditSum, credit) => creditSum + credit.quantity, 0)
  ), 0);
  const status = completed >= lotStep.remainingQty
    ? WipRequirementStatus.COMPLETED
    : completed > 0
      ? WipRequirementStatus.IN_PROGRESS
      : WipRequirementStatus.SCHEDULED;
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
  const allocationStep = await tx.wipWeekAllocationStep.findUnique({
    where: { id: input.resolution.allocationStepId },
    select: {
      id: true,
      lotStepId: true,
      plannedQty: true,
      completedQty: true,
      plannedStandardMilliseconds: true,
      completedStandardMilliseconds: true,
      allocation: { select: { id: true, lotId: true } },
    },
  });
  if (!allocationStep) {
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
        status: WipRequirementStatus.IN_PROGRESS,
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
