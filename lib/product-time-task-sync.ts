import {
  DailyProcessTaskStatus,
  DailyTaskAssignmentStatus,
  Prisma,
} from '@prisma/client';
import { allocateIncrementalTaskLabor } from '@/lib/daily-plan-domain';

export type ProductTimeTaskSyncResult = {
  synchronized: number;
  reviewRequired: number;
};

type ProductTimeTaskSyncInput = {
  drawingLibraryItemId: string;
  profileId: string;
  profileVersion: number;
  actorId: string;
  routeId?: string;
  reason?: string;
};

const mutableTaskStatuses: DailyProcessTaskStatus[] = [
  DailyProcessTaskStatus.COMPLETED,
  DailyProcessTaskStatus.CARRIED_OVER,
  DailyProcessTaskStatus.CANCELLED,
  DailyProcessTaskStatus.NEEDS_REVIEW,
];

/**
 * Reprojects the current route-step snapshot into unfinished daily tasks and
 * employee planned labor.  The operation is intentionally idempotent so it can
 * be used by publish, manual reconciliation, and completion withdrawal.
 */
export async function syncUnfinishedDailyTasksFromPublishedProductTime(
  tx: Prisma.TransactionClient,
  input: ProductTimeTaskSyncInput,
): Promise<ProductTimeTaskSyncResult> {
  const unfinishedDailyTasks = await tx.dailyProcessTask.findMany({
    where: {
      workOrder: { drawingLibraryItemId: input.drawingLibraryItemId },
      ...(input.routeId ? { routeId: input.routeId } : {}),
      status: { notIn: mutableTaskStatuses },
    },
    select: {
      id: true,
      planId: true,
      status: true,
      version: true,
      productTimeProfileId: true,
      productTimeProfileVersion: true,
      routeVersion: true,
      processCode: true,
      processName: true,
      stageGroup: true,
      position: true,
      sequenceGroup: true,
      standardSource: true,
      timeBasis: true,
      unitLabel: true,
      standardMillisecondsPerUnit: true,
      setupMilliseconds: true,
      unitsPerProduct: true,
      countsForEfficiency: true,
      route: {
        select: {
          version: true,
          productTimeProfileId: true,
          productTimeProfileVersion: true,
        },
      },
      step: {
        select: {
          processCode: true,
          processName: true,
          stageGroup: true,
          position: true,
          sequenceGroup: true,
          standardSource: true,
          timeBasis: true,
          unitLabel: true,
          standardMillisecondsPerUnit: true,
          setupMilliseconds: true,
          unitsPerProduct: true,
          countsForEfficiency: true,
          productTimeProfileId: true,
          productTimeProfileVersion: true,
        },
      },
      assignments: {
        where: { status: { not: DailyTaskAssignmentStatus.CANCELLED } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          quantity: true,
          plannedStandardMilliseconds: true,
        },
      },
    },
  });

  let synchronized = 0;
  let reviewRequired = 0;
  for (const task of unfinishedDailyTasks) {
    const synchronizedStep = task.step.productTimeProfileId === input.profileId
      && task.step.productTimeProfileVersion === input.profileVersion
      && task.route.productTimeProfileId === input.profileId
      && task.route.productTimeProfileVersion === input.profileVersion
      && (task.step.timeBasis === 'per_unit' || task.step.timeBasis === 'per_batch')
      && Boolean(task.step.unitLabel)
      && Number(task.step.standardMillisecondsPerUnit || 0) > 0;
    if (synchronizedStep) {
      const allocations = allocateIncrementalTaskLabor({
        snapshot: {
          timeBasis: task.step.timeBasis as 'per_unit' | 'per_batch',
          standardMillisecondsPerUnit: task.step.standardMillisecondsPerUnit as number,
          setupMilliseconds: task.step.setupMilliseconds,
          unitsPerProduct: task.step.unitsPerProduct,
        },
        alreadyAssignedQuantity: 0,
        quantities: task.assignments.map(assignment => assignment.quantity),
      });
      const taskSnapshotMatches = task.routeVersion === task.route.version
        && task.processCode === task.step.processCode
        && task.processName === task.step.processName
        && task.stageGroup === task.step.stageGroup
        && task.position === task.step.position
        && task.sequenceGroup === task.step.sequenceGroup
        && task.standardSource === task.step.standardSource
        && task.timeBasis === task.step.timeBasis
        && task.unitLabel === task.step.unitLabel
        && task.standardMillisecondsPerUnit === task.step.standardMillisecondsPerUnit
        && task.setupMilliseconds === task.step.setupMilliseconds
        && task.unitsPerProduct === task.step.unitsPerProduct
        && task.countsForEfficiency === task.step.countsForEfficiency
        && task.productTimeProfileId === input.profileId
        && task.productTimeProfileVersion === input.profileVersion
        && task.assignments.every((assignment, index) => (
          assignment.plannedStandardMilliseconds === allocations[index]
        ));
      if (taskSnapshotMatches) continue;

      const updatedTask = await tx.dailyProcessTask.updateMany({
        where: { id: task.id, version: task.version, status: { notIn: mutableTaskStatuses } },
        data: {
          routeVersion: task.route.version,
          processCode: task.step.processCode,
          processName: task.step.processName,
          stageGroup: task.step.stageGroup,
          position: task.step.position,
          sequenceGroup: task.step.sequenceGroup,
          standardSource: task.step.standardSource,
          timeBasis: task.step.timeBasis as 'per_unit' | 'per_batch',
          unitLabel: task.step.unitLabel as string,
          standardMillisecondsPerUnit: task.step.standardMillisecondsPerUnit as number,
          setupMilliseconds: task.step.setupMilliseconds,
          unitsPerProduct: task.step.unitsPerProduct,
          countsForEfficiency: task.step.countsForEfficiency,
          productTimeProfileId: input.profileId,
          productTimeProfileVersion: input.profileVersion,
          version: { increment: 1 },
        },
      });
      if (updatedTask.count !== 1) continue;
      for (let index = 0; index < task.assignments.length; index += 1) {
        await tx.dailyTaskAssignment.update({
          where: { id: task.assignments[index].id },
          data: {
            plannedStandardMilliseconds: allocations[index],
            version: { increment: 1 },
          },
        });
      }
      synchronized += 1;
      await tx.dailyPlanRevision.create({
        data: {
          planId: task.planId,
          taskId: task.id,
          action: 'PRODUCT_TIME_REPUBLISHED_SYNCHRONIZED',
          beforeData: {
            processCode: task.processCode,
            processName: task.processName,
            position: task.position,
            sequenceGroup: task.sequenceGroup,
            standardMillisecondsPerUnit: task.standardMillisecondsPerUnit,
            productTimeProfileId: task.productTimeProfileId,
            productTimeProfileVersion: task.productTimeProfileVersion,
            routeVersion: task.routeVersion,
          },
          afterData: {
            processCode: task.step.processCode,
            processName: task.step.processName,
            position: task.step.position,
            sequenceGroup: task.step.sequenceGroup,
            standardMillisecondsPerUnit: task.step.standardMillisecondsPerUnit,
            productTimeProfileId: input.profileId,
            productTimeProfileVersion: input.profileVersion,
            routeVersion: task.route.version,
            assignmentCount: task.assignments.length,
          },
          reason: input.reason || `产品工序与工时 V${input.profileVersion} 已发布，系统自动同步未完成日任务及人员计划工时`,
          actorId: input.actorId,
          idempotencyKey: `product-time-sync:${input.profileId}:${task.id}:${task.version}`.slice(0, 190),
        },
      });
      continue;
    }

    const updatedTask = await tx.dailyProcessTask.updateMany({
      where: { id: task.id, version: task.version, status: { notIn: mutableTaskStatuses } },
      data: { status: DailyProcessTaskStatus.NEEDS_REVIEW, version: { increment: 1 } },
    });
    if (updatedTask.count !== 1) continue;
    reviewRequired += 1;
    await tx.dailyPlanRevision.create({
      data: {
        planId: task.planId,
        taskId: task.id,
        action: 'PRODUCT_TIME_REPUBLISHED_REVIEW_REQUIRED',
        beforeData: {
          status: task.status,
          productTimeProfileId: task.productTimeProfileId,
          productTimeProfileVersion: task.productTimeProfileVersion,
          routeVersion: task.routeVersion,
        },
        afterData: {
          status: DailyProcessTaskStatus.NEEDS_REVIEW,
          publishedProductTimeProfileId: input.profileId,
          publishedProductTimeProfileVersion: input.profileVersion,
        },
        reason: input.reason || '产品工序与工时版本已重新发布，请复核未完成日任务',
        actorId: input.actorId,
        idempotencyKey: `product-time-review:${input.profileId}:${task.id}:${task.version}`.slice(0, 190),
      },
    });
  }
  return { synchronized, reviewRequired };
}
