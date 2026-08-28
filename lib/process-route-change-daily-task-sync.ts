import {
  DailyProcessTaskStatus,
  DailyProductionPlanStatus,
  DailyTaskAssignmentStatus,
  Prisma,
  ProcessStepExecutionMode,
  ProcessSupplementObligationStatus,
} from '@prisma/client';
import {
  allocateIncrementalTaskLabor,
  resolveDailyTaskProgress,
} from '@/lib/daily-plan-domain';
import { processSupplementActualRequiredQty } from '@/lib/process-supplement-coverage';

export type ProcessRouteChangeInsertedDailyStep = {
  stepId: string;
  insertBeforeStepId?: string | null;
};

export type ProcessRouteChangeDailyTaskSyncInput = {
  changeId: string;
  routeId: string;
  actorId: string | null;
  insertedSteps?: readonly ProcessRouteChangeInsertedDailyStep[];
  timeChangedStepIds?: readonly string[];
  reason?: string;
};

export type ProcessRouteChangeDailyTaskSyncResult = {
  createdTasks: number;
  synchronizedTasks: number;
  synchronizedAssignments: number;
  preservedHistoricalTasks: number;
  skippedFrozenPlans: number;
};

export class ProcessRouteChangeDailyTaskSyncError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'ProcessRouteChangeDailyTaskSyncError';
    this.code = code;
  }
}

async function recordTaskSyncRevision(
  tx: Prisma.TransactionClient,
  actorId: string | null,
  data: Omit<Prisma.DailyPlanRevisionUncheckedCreateInput, 'actorId'>,
) {
  if (actorId) {
    await tx.dailyPlanRevision.create({ data: { ...data, actorId } });
  } else {
    // Background recovery must not impersonate the original reporter. The
    // user-owned revision table requires an actor; use the system audit instead.
    await tx.operationLog.create({
      data: {
        action: data.action, targetType: 'DailyProcessTask', targetId: data.taskId,
        detail: JSON.parse(JSON.stringify({ ...data, source: 'supplement_completion_recovery' })) as Prisma.InputJsonValue,
      },
    });
  }
}

const HISTORICAL_TASK_STATUSES = new Set<DailyProcessTaskStatus>([
  DailyProcessTaskStatus.COMPLETED,
  DailyProcessTaskStatus.CARRIED_OVER,
  DailyProcessTaskStatus.CANCELLED,
]);

const PROGRESS_PRESERVING_TASK_STATUSES = new Set<DailyProcessTaskStatus>([
  DailyProcessTaskStatus.PENDING_CARRY_OVER,
  DailyProcessTaskStatus.NEEDS_REVIEW,
]);

const MUTABLE_ASSIGNMENT_STATUSES = new Set<DailyTaskAssignmentStatus>([
  DailyTaskAssignmentStatus.PLANNED,
  DailyTaskAssignmentStatus.ACTIVE,
]);

const FROZEN_PLAN_STATUSES = new Set<DailyProductionPlanStatus>([
  DailyProductionPlanStatus.ARCHIVED,
  DailyProductionPlanStatus.CANCELLED,
]);

const ROUTE_CHANGE_WARNING = 'PROCESS_ROUTE_CHANGE_NEW';
const INSERTED_WARNING = 'PROCESS_ROUTE_CHANGE_INSERTED';
const TIME_CHANGED_WARNING = 'PROCESS_ROUTE_CHANGE_TIME_UPDATED';
const SUPPLEMENT_WARNING = 'PROCESS_SUPPLEMENT_OBLIGATION';
const ZERO_MATERIAL_WARNING = 'ZERO_MATERIAL_FLOW';
const SUPPLEMENT_BLOCKED_WARNING = 'PROCESS_SUPPLEMENT_BLOCKED';
const WAITING_WARNING = 'WAITING_UPSTREAM';

type DailyTaskProjectionInput = {
  currentStatus: DailyProcessTaskStatus;
  currentAvailableQty: number;
  plannedQty: number;
  stepStatus: string;
  stepInputQty: number;
  stepProcessedQty: number;
  executionMode: ProcessStepExecutionMode;
  supplementStatus?: ProcessSupplementObligationStatus | null;
  supplementRequiredQty?: number | null;
  supplementActualRequiredQty?: number | null;
  supplementReportedQty?: number | null;
  blockedBySupplement?: boolean;
};

/**
 * Derives a daily-task view from route facts without inventing a quantity
 * movement.  A supplemental obligation is deliberately visible with zero
 * material availability because it is reported through the QR obligation
 * endpoint, not through the normal material-flow completion endpoint.
 */
export function projectProcessRouteChangeDailyTask(
  input: DailyTaskProjectionInput,
): { status: DailyProcessTaskStatus; availableQty: number } {
  if (HISTORICAL_TASK_STATUSES.has(input.currentStatus)) {
    return { status: input.currentStatus, availableQty: input.currentAvailableQty };
  }
  if (PROGRESS_PRESERVING_TASK_STATUSES.has(input.currentStatus)) {
    return { status: input.currentStatus, availableQty: input.currentAvailableQty };
  }
  if (input.executionMode === ProcessStepExecutionMode.SUPPLEMENTAL_OBLIGATION) {
    if (input.supplementStatus === ProcessSupplementObligationStatus.CANCELLED) {
      return { status: DailyProcessTaskStatus.CANCELLED, availableQty: 0 };
    }
    if (
      input.supplementStatus === ProcessSupplementObligationStatus.FULFILLED
      || input.stepStatus === 'completed'
      || Number(input.supplementReportedQty || 0) >= Number(
        input.supplementActualRequiredQty ?? input.supplementRequiredQty ?? 0,
      )
    ) {
      return { status: DailyProcessTaskStatus.COMPLETED, availableQty: 0 };
    }
    if (Number(input.supplementReportedQty || 0) > 0) {
      return { status: DailyProcessTaskStatus.IN_PROGRESS, availableQty: 0 };
    }
    return { status: DailyProcessTaskStatus.WAITING_UPSTREAM, availableQty: 0 };
  }
  if (input.blockedBySupplement && input.stepStatus !== 'completed' && input.stepStatus !== 'skipped') {
    return { status: DailyProcessTaskStatus.WAITING_UPSTREAM, availableQty: 0 };
  }
  const projected = resolveDailyTaskProgress({
    currentStatus: input.currentStatus,
    currentAvailableQty: input.currentAvailableQty,
    plannedQty: input.plannedQty,
    inputQty: input.stepInputQty,
    processedQty: input.stepProcessedQty,
    stepStatus: input.stepStatus,
  });
  return {
    status: projected.status as DailyProcessTaskStatus,
    availableQty: projected.availableQty,
  };
}

function warningStrings(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function uniqueWarnings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function sameWarnings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function synchronizedWarnings(input: {
  current: Prisma.JsonValue | null;
  inserted: boolean;
  timeChanged: boolean;
  supplement: boolean;
  blockedBySupplement: boolean;
  waiting: boolean;
}) {
  const managed = new Set([
    INSERTED_WARNING,
    TIME_CHANGED_WARNING,
    SUPPLEMENT_WARNING,
    ZERO_MATERIAL_WARNING,
    SUPPLEMENT_BLOCKED_WARNING,
    WAITING_WARNING,
  ]);
  const retained = warningStrings(input.current).filter(item => !managed.has(item));
  if (input.inserted || input.timeChanged) retained.push(ROUTE_CHANGE_WARNING);
  if (input.inserted) retained.push(INSERTED_WARNING);
  if (input.timeChanged) retained.push(TIME_CHANGED_WARNING);
  if (input.supplement) retained.push(SUPPLEMENT_WARNING, ZERO_MATERIAL_WARNING);
  if (input.blockedBySupplement) retained.push(SUPPLEMENT_BLOCKED_WARNING);
  if (input.waiting) retained.push(WAITING_WARNING);
  return uniqueWarnings(retained);
}

function validStepTime(step: {
  timeBasis: string | null;
  unitLabel: string | null;
  standardMillisecondsPerUnit: number | null;
  setupMilliseconds: number;
  unitsPerProduct: number;
}) {
  if (
    (step.timeBasis !== 'per_unit' && step.timeBasis !== 'per_batch')
    || !step.unitLabel
    || !Number.isSafeInteger(step.standardMillisecondsPerUnit)
    || Number(step.standardMillisecondsPerUnit) <= 0
    || !Number.isSafeInteger(step.setupMilliseconds)
    || step.setupMilliseconds < 0
    || !Number.isSafeInteger(step.unitsPerProduct)
    || step.unitsPerProduct <= 0
  ) {
    throw new ProcessRouteChangeDailyTaskSyncError(
      `${'processName' in step ? String(step.processName) : '工序'}缺少有效工时，不能同步日任务`,
      'PROCESS_ROUTE_CHANGE_DAILY_TASK_INVALID_TIME',
    );
  }
  return {
    timeBasis: step.timeBasis as 'per_unit' | 'per_batch',
    unitLabel: step.unitLabel as string,
    standardMillisecondsPerUnit: step.standardMillisecondsPerUnit as number,
    setupMilliseconds: step.setupMilliseconds,
    unitsPerProduct: step.unitsPerProduct,
  } as const;
}

/**
 * Synchronizes only planning projections.  It never writes route quantities or
 * completion facts.  The caller must invoke it in the same serializable
 * transaction after the route version/steps have been updated.
 */
export async function syncDailyTasksAfterProcessRouteChange(
  tx: Prisma.TransactionClient,
  input: ProcessRouteChangeDailyTaskSyncInput,
): Promise<ProcessRouteChangeDailyTaskSyncResult> {
  const route = await tx.workOrderProcessRoute.findUnique({
    where: { id: input.routeId },
    select: {
      id: true,
      version: true,
      workOrderId: true,
      productTimeProfileId: true,
      productTimeProfileVersion: true,
      steps: {
        where: { retiredAt: null },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
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
          executionMode: true,
          inputQty: true,
          processedQty: true,
          status: true,
          supplementObligation: {
            select: {
              status: true,
              requiredQty: true,
              systemCoveredQty: true,
              reportedQty: true,
              fulfillmentMode: true,
              insertBeforeStepId: true,
            },
          },
        },
      },
    },
  });
  if (!route) {
    throw new ProcessRouteChangeDailyTaskSyncError(
      '工艺路线不存在，不能同步日任务',
      'PROCESS_ROUTE_CHANGE_DAILY_TASK_ROUTE_MISSING',
    );
  }

  const tasks = await tx.dailyProcessTask.findMany({
    where: { routeId: input.routeId, productionSuspendedAt: null },
    orderBy: [{ workDate: 'asc' }, { sortOrder: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      planId: true,
      workDate: true,
      shiftCode: true,
      productionPlanBatchId: true,
      workOrderId: true,
      routeId: true,
      stepId: true,
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
      productTimeProfileId: true,
      productTimeProfileVersion: true,
      plannedQty: true,
      availableQty: true,
      priority: true,
      priorityReason: true,
      riskWarnings: true,
      status: true,
      sortOrder: true,
      version: true,
      createdAt: true,
      plan: { select: { status: true, version: true } },
      assignments: {
        where: { status: { not: DailyTaskAssignmentStatus.CANCELLED } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          quantity: true,
          plannedStandardMilliseconds: true,
          status: true,
          version: true,
        },
      },
    },
  });

  const insertedByStepId = new Map<string, ProcessRouteChangeInsertedDailyStep>();
  for (const inserted of input.insertedSteps || []) {
    if (!inserted.stepId || insertedByStepId.has(inserted.stepId)) continue;
    insertedByStepId.set(inserted.stepId, inserted);
  }
  const timeChangedStepIds = new Set(input.timeChangedStepIds || []);
  const stepById = new Map(route.steps.map(step => [step.id, step] as const));
  for (const stepId of [...insertedByStepId.keys(), ...timeChangedStepIds]) {
    if (!stepById.has(stepId)) {
      throw new ProcessRouteChangeDailyTaskSyncError(
        '本次工艺变更引用的工序已不存在，不能同步日任务',
        'PROCESS_ROUTE_CHANGE_DAILY_TASK_STEP_MISSING',
      );
    }
  }

  const activeSupplementPositions = route.steps
    .filter(step => (
      step.executionMode === ProcessStepExecutionMode.SUPPLEMENTAL_OBLIGATION
      && step.supplementObligation?.status === ProcessSupplementObligationStatus.ACTIVE
    ))
    .map(step => step.position);
  const blockedBySupplement = (step: (typeof route.steps)[number]) => (
    step.executionMode === ProcessStepExecutionMode.NORMAL
    && activeSupplementPositions.some(position => position < step.position)
  );

  let synchronizedTasks = 0;
  let synchronizedAssignments = 0;
  let preservedHistoricalTasks = 0;
  for (const task of tasks) {
    if (HISTORICAL_TASK_STATUSES.has(task.status)) {
      preservedHistoricalTasks += 1;
      continue;
    }
    const step = stepById.get(task.stepId);
    if (!step) {
      throw new ProcessRouteChangeDailyTaskSyncError(
        `${task.processName}对应的路线工序已不存在，不能静默覆盖日任务`,
        'PROCESS_ROUTE_CHANGE_DAILY_TASK_STEP_MISSING',
      );
    }
    const time = validStepTime(step);
    const supplementBlocked = blockedBySupplement(step);
    const projected = projectProcessRouteChangeDailyTask({
      currentStatus: task.status,
      currentAvailableQty: task.availableQty,
      plannedQty: task.plannedQty,
      stepStatus: step.status,
      stepInputQty: step.inputQty,
      stepProcessedQty: step.processedQty,
      executionMode: step.executionMode,
      supplementStatus: step.supplementObligation?.status,
      supplementRequiredQty: step.supplementObligation?.requiredQty,
      supplementActualRequiredQty: step.supplementObligation
        ? processSupplementActualRequiredQty(step.supplementObligation)
        : null,
      supplementReportedQty: step.supplementObligation?.reportedQty,
      blockedBySupplement: supplementBlocked,
    });
    const warnings = synchronizedWarnings({
      current: task.riskWarnings,
      inserted: insertedByStepId.has(step.id),
      timeChanged: timeChangedStepIds.has(step.id),
      supplement: step.executionMode === ProcessStepExecutionMode.SUPPLEMENTAL_OBLIGATION,
      blockedBySupplement: supplementBlocked,
      waiting: projected.status === DailyProcessTaskStatus.WAITING_UPSTREAM,
    });
    const allocations = allocateIncrementalTaskLabor({
      snapshot: {
        timeBasis: time.timeBasis,
        standardMillisecondsPerUnit: time.standardMillisecondsPerUnit,
        setupMilliseconds: time.setupMilliseconds,
        unitsPerProduct: time.unitsPerProduct,
      },
      alreadyAssignedQuantity: 0,
      quantities: task.assignments.map(assignment => assignment.quantity),
    });
    const assignmentChanged = task.assignments.some((assignment, index) => (
      MUTABLE_ASSIGNMENT_STATUSES.has(assignment.status)
      && assignment.plannedStandardMilliseconds !== allocations[index]
    ));
    const taskChanged = task.routeVersion !== route.version
      || task.processCode !== step.processCode
      || task.processName !== step.processName
      || task.stageGroup !== step.stageGroup
      || task.position !== step.position
      || task.sequenceGroup !== step.sequenceGroup
      || task.standardSource !== step.standardSource
      || task.timeBasis !== time.timeBasis
      || task.unitLabel !== time.unitLabel
      || task.standardMillisecondsPerUnit !== time.standardMillisecondsPerUnit
      || task.setupMilliseconds !== time.setupMilliseconds
      || task.unitsPerProduct !== time.unitsPerProduct
      || task.countsForEfficiency !== step.countsForEfficiency
      || task.productTimeProfileId !== step.productTimeProfileId
      || task.productTimeProfileVersion !== step.productTimeProfileVersion
      || task.status !== projected.status
      || task.availableQty !== projected.availableQty
      || !sameWarnings(warningStrings(task.riskWarnings), warnings);
    if (!taskChanged && !assignmentChanged) continue;

    const updated = await tx.dailyProcessTask.updateMany({
      where: {
        id: task.id,
        version: task.version,
        status: task.status,
      },
      data: {
        routeVersion: route.version,
        processCode: step.processCode,
        processName: step.processName,
        stageGroup: step.stageGroup,
        position: step.position,
        sequenceGroup: step.sequenceGroup,
        standardSource: step.standardSource,
        timeBasis: time.timeBasis,
        unitLabel: time.unitLabel,
        standardMillisecondsPerUnit: time.standardMillisecondsPerUnit,
        setupMilliseconds: time.setupMilliseconds,
        unitsPerProduct: time.unitsPerProduct,
        countsForEfficiency: step.countsForEfficiency,
        productTimeProfileId: step.productTimeProfileId,
        productTimeProfileVersion: step.productTimeProfileVersion,
        status: projected.status,
        availableQty: projected.availableQty,
        riskWarnings: warnings,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new ProcessRouteChangeDailyTaskSyncError(
        `${task.processName}日任务版本已变化，请刷新后重新启用`,
        'PROCESS_ROUTE_CHANGE_DAILY_TASK_VERSION_CONFLICT',
      );
    }
    for (let index = 0; index < task.assignments.length; index += 1) {
      const assignment = task.assignments[index];
      if (
        !MUTABLE_ASSIGNMENT_STATUSES.has(assignment.status)
        || assignment.plannedStandardMilliseconds === allocations[index]
      ) continue;
      const assignmentUpdate = await tx.dailyTaskAssignment.updateMany({
        where: {
          id: assignment.id,
          version: assignment.version,
          status: assignment.status,
        },
        data: {
          plannedStandardMilliseconds: allocations[index],
          version: { increment: 1 },
        },
      });
      if (assignmentUpdate.count !== 1) {
        throw new ProcessRouteChangeDailyTaskSyncError(
          `${task.processName}人员分配版本已变化，请刷新后重新启用`,
          'PROCESS_ROUTE_CHANGE_DAILY_ASSIGNMENT_VERSION_CONFLICT',
        );
      }
      synchronizedAssignments += 1;
    }
    await recordTaskSyncRevision(tx, input.actorId, {
      planId: task.planId,
      taskId: task.id,
      action: 'PROCESS_ROUTE_CHANGE_TASK_SYNCHRONIZED',
      beforeData: {
        routeVersion: task.routeVersion,
        processCode: task.processCode,
        processName: task.processName,
        position: task.position,
        sequenceGroup: task.sequenceGroup,
        standardMillisecondsPerUnit: task.standardMillisecondsPerUnit,
        status: task.status,
        availableQty: task.availableQty,
      },
      afterData: {
        changeId: input.changeId,
        routeVersion: route.version,
        processCode: step.processCode,
        processName: step.processName,
        position: step.position,
        sequenceGroup: step.sequenceGroup,
        standardMillisecondsPerUnit: time.standardMillisecondsPerUnit,
        status: projected.status,
        availableQty: projected.availableQty,
        synchronizedAssignmentCount: task.assignments.filter(assignment => (
          MUTABLE_ASSIGNMENT_STATUSES.has(assignment.status)
        )).length,
      },
      reason: input.reason || `工艺变更 ${input.changeId} 已启用，同步未完成日任务`,
      idempotencyKey: `route-change-task-sync:${input.changeId}:${route.version}:${task.id}:${task.version}`.slice(0, 190),
    });
    synchronizedTasks += 1;
  }

  const tasksByPlan = new Map<string, typeof tasks>();
  for (const task of tasks) {
    const group = tasksByPlan.get(task.planId) || [];
    group.push(task);
    tasksByPlan.set(task.planId, group);
  }
  const createdPlanIds = new Set<string>();
  let createdTasks = 0;
  let skippedFrozenPlans = 0;
  for (const inserted of insertedByStepId.values()) {
    const step = stepById.get(inserted.stepId)!;
    const time = validStepTime(step);
    const existingInsertedTasks = tasks.filter(task => (
      task.stepId === step.id
      && task.status !== DailyProcessTaskStatus.CANCELLED
      && task.status !== DailyProcessTaskStatus.CARRIED_OVER
    ));
    let supplementalRemaining = step.executionMode === ProcessStepExecutionMode.SUPPLEMENTAL_OBLIGATION
      ? Math.max(
          0,
          (step.supplementObligation
            ? processSupplementActualRequiredQty(step.supplementObligation)
            : 0)
            - existingInsertedTasks.reduce((sum, task) => sum + task.plannedQty, 0),
        )
      : null;
    const candidateTemplates = [...tasksByPlan.values()]
      .map(planTasks => {
        if (planTasks.some(task => task.stepId === step.id)) return null;
        const planStatus = planTasks[0]?.plan.status;
        if (!planStatus) return null;
        if (FROZEN_PLAN_STATUSES.has(planStatus)) {
          skippedFrozenPlans += 1;
          return null;
        }
        const eligible = planTasks.filter(task => (
          task.status !== DailyProcessTaskStatus.CANCELLED
          && task.status !== DailyProcessTaskStatus.CARRIED_OVER
        ));
        if (!eligible.length) return null;
        if (inserted.insertBeforeStepId) {
          const exact = eligible.find(task => task.stepId === inserted.insertBeforeStepId);
          if (exact) return exact;
          const targetStep = stepById.get(inserted.insertBeforeStepId);
          if (!targetStep) return null;
          return eligible.find(task => stepById.get(task.stepId)?.sequenceGroup === targetStep.sequenceGroup) || null;
        }
        return [...eligible].sort((left, right) => (
          right.position - left.position || right.createdAt.getTime() - left.createdAt.getTime()
        ))[0] || null;
      })
      .filter((task): task is NonNullable<typeof task> => Boolean(task))
      .sort((left, right) => (
        left.workDate.getTime() - right.workDate.getTime()
        || left.sortOrder - right.sortOrder
        || left.createdAt.getTime() - right.createdAt.getTime()
      ));

    for (const template of candidateTemplates) {
      const plannedQty = supplementalRemaining == null
        ? template.plannedQty
        : Math.min(template.plannedQty, supplementalRemaining);
      if (plannedQty <= 0) continue;
      const supplementBlocked = blockedBySupplement(step);
      const projected = projectProcessRouteChangeDailyTask({
        currentStatus: DailyProcessTaskStatus.UNPLANNED,
        currentAvailableQty: 0,
        plannedQty,
        stepStatus: step.status,
        stepInputQty: step.inputQty,
        stepProcessedQty: step.processedQty,
        executionMode: step.executionMode,
        supplementStatus: step.supplementObligation?.status,
        supplementRequiredQty: step.supplementObligation?.requiredQty,
        supplementActualRequiredQty: step.supplementObligation
          ? processSupplementActualRequiredQty(step.supplementObligation)
          : null,
        supplementReportedQty: step.supplementObligation?.reportedQty,
        blockedBySupplement: supplementBlocked,
      });
      const warnings = synchronizedWarnings({
        current: template.riskWarnings,
        inserted: true,
        timeChanged: timeChangedStepIds.has(step.id),
        supplement: step.executionMode === ProcessStepExecutionMode.SUPPLEMENTAL_OBLIGATION,
        blockedBySupplement: supplementBlocked,
        waiting: projected.status === DailyProcessTaskStatus.WAITING_UPSTREAM,
      });
      const created = await tx.dailyProcessTask.create({
        data: {
          planId: template.planId,
          workDate: template.workDate,
          shiftCode: template.shiftCode,
          productionPlanBatchId: template.productionPlanBatchId,
          workOrderId: route.workOrderId,
          routeId: route.id,
          stepId: step.id,
          routeVersion: route.version,
          processCode: step.processCode,
          processName: step.processName,
          stageGroup: step.stageGroup,
          position: step.position,
          sequenceGroup: step.sequenceGroup,
          standardSource: step.standardSource,
          timeBasis: time.timeBasis,
          unitLabel: time.unitLabel,
          standardMillisecondsPerUnit: time.standardMillisecondsPerUnit,
          setupMilliseconds: time.setupMilliseconds,
          unitsPerProduct: time.unitsPerProduct,
          countsForEfficiency: step.countsForEfficiency,
          productTimeProfileId: step.productTimeProfileId,
          productTimeProfileVersion: step.productTimeProfileVersion,
          plannedQty,
          availableQty: projected.availableQty,
          priority: template.priority,
          priorityReason: template.priorityReason,
          riskWarnings: warnings,
          status: projected.status,
          sortOrder: template.sortOrder,
        },
        select: { id: true },
      });
      await recordTaskSyncRevision(tx, input.actorId, {
        planId: template.planId,
        taskId: created.id,
        action: 'PROCESS_ROUTE_CHANGE_TASK_CREATED',
        afterData: {
          changeId: input.changeId,
          routeVersion: route.version,
          stepId: step.id,
          processCode: step.processCode,
          processName: step.processName,
          executionMode: step.executionMode,
          plannedQty,
          availableQty: projected.availableQty,
          status: projected.status,
        },
        reason: input.reason || `工艺变更 ${input.changeId} 新增工序已同步到日计划`,
        idempotencyKey: `route-change-task-create:${input.changeId}:${template.planId}:${step.id}`.slice(0, 190),
      });
      createdPlanIds.add(template.planId);
      createdTasks += 1;
      if (supplementalRemaining != null) supplementalRemaining -= plannedQty;
    }
  }

  for (const planId of createdPlanIds) {
    const originalPlan = tasksByPlan.get(planId)?.[0]?.plan;
    if (!originalPlan) continue;
    const planUpdate = await tx.dailyProductionPlan.updateMany({
      where: { id: planId, version: originalPlan.version, status: originalPlan.status },
      data: { ...(input.actorId ? { updatedById: input.actorId } : {}), version: { increment: 1 } },
    });
    if (planUpdate.count !== 1) {
      throw new ProcessRouteChangeDailyTaskSyncError(
        '日计划版本已变化，请刷新后重新启用工艺变更',
        'PROCESS_ROUTE_CHANGE_DAILY_PLAN_VERSION_CONFLICT',
      );
    }
  }

  return {
    createdTasks,
    synchronizedTasks,
    synchronizedAssignments,
    preservedHistoricalTasks,
    skippedFrozenPlans,
  };
}
