import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DailyProcessTaskStatus,
  DailyProductionPlanStatus,
  DailyTaskAssignmentStatus,
  Prisma,
  ProcessStepExecutionMode,
  ProcessSupplementObligationStatus,
} from '@prisma/client';
import {
  projectProcessRouteChangeDailyTask,
  syncDailyTasksAfterProcessRouteChange,
} from '../lib/process-route-change-daily-task-sync';

test('daily task projection blocks stale normal availability and keeps supplement material at zero', () => {
  const normal = projectProcessRouteChangeDailyTask({
    currentStatus: DailyProcessTaskStatus.READY,
    currentAvailableQty: 10,
    plannedQty: 10,
    stepStatus: 'pending',
    stepInputQty: 0,
    stepProcessedQty: 0,
    executionMode: ProcessStepExecutionMode.NORMAL,
  });
  assert.deepEqual(normal, {
    status: DailyProcessTaskStatus.WAITING_UPSTREAM,
    availableQty: 0,
  });

  const supplement = projectProcessRouteChangeDailyTask({
    currentStatus: DailyProcessTaskStatus.UNPLANNED,
    currentAvailableQty: 0,
    plannedQty: 10,
    stepStatus: 'current',
    stepInputQty: 0,
    stepProcessedQty: 0,
    executionMode: ProcessStepExecutionMode.SUPPLEMENTAL_OBLIGATION,
    supplementStatus: ProcessSupplementObligationStatus.ACTIVE,
    supplementRequiredQty: 10,
    supplementReportedQty: 4,
  });
  assert.deepEqual(supplement, {
    status: DailyProcessTaskStatus.IN_PROGRESS,
    availableQty: 0,
  });

  const blocked = projectProcessRouteChangeDailyTask({
    currentStatus: DailyProcessTaskStatus.READY,
    currentAvailableQty: 10,
    plannedQty: 10,
    stepStatus: 'current',
    stepInputQty: 10,
    stepProcessedQty: 0,
    executionMode: ProcessStepExecutionMode.NORMAL,
    blockedBySupplement: true,
  });
  assert.deepEqual(blocked, {
    status: DailyProcessTaskStatus.WAITING_UPSTREAM,
    availableQty: 0,
  });
});

test('completed daily task projection preserves the original plan snapshot', () => {
  const projected = projectProcessRouteChangeDailyTask({
    currentStatus: DailyProcessTaskStatus.COMPLETED,
    currentAvailableQty: 3,
    plannedQty: 10,
    stepStatus: 'current',
    stepInputQty: 10,
    stepProcessedQty: 0,
    executionMode: ProcessStepExecutionMode.NORMAL,
    blockedBySupplement: true,
  });
  assert.deepEqual(projected, {
    status: DailyProcessTaskStatus.COMPLETED,
    availableQty: 3,
  });
});

type FakeAssignment = {
  id: string;
  quantity: number;
  plannedStandardMilliseconds: bigint;
  status: DailyTaskAssignmentStatus;
  version: number;
};

type FakeTask = {
  id: string;
  planId: string;
  workDate: Date;
  shiftCode: string;
  productionPlanBatchId: string | null;
  workOrderId: string;
  routeId: string;
  stepId: string;
  routeVersion: number;
  processCode: string;
  processName: string;
  stageGroup: string;
  position: number;
  sequenceGroup: number;
  standardSource: string;
  timeBasis: string;
  unitLabel: string;
  standardMillisecondsPerUnit: number;
  setupMilliseconds: number;
  unitsPerProduct: number;
  countsForEfficiency: boolean;
  productTimeProfileId: string | null;
  productTimeProfileVersion: number | null;
  plannedQty: number;
  availableQty: number;
  priority: number;
  priorityReason: string | null;
  riskWarnings: string[] | null;
  status: DailyProcessTaskStatus;
  sortOrder: number;
  version: number;
  createdAt: Date;
  plan: { status: DailyProductionPlanStatus; version: number };
  assignments: FakeAssignment[];
};

function applyMutation(target: Record<string, unknown>, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    if (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && 'increment' in value
    ) {
      target[key] = Number(target[key] || 0) + Number((value as { increment: number }).increment);
    } else {
      target[key] = value;
    }
  }
}

test('route-change task sync creates inserted tasks, recalculates open assignments, and is idempotent', async () => {
  const plan = { status: DailyProductionPlanStatus.IN_PROGRESS, version: 4 };
  const date = new Date('2026-08-11T00:00:00.000Z');
  const tasks: FakeTask[] = [
    {
      id: 'completed-task', planId: 'plan-1', workDate: date, shiftCode: 'DAY', productionPlanBatchId: 'batch-1',
      workOrderId: 'work-order-1', routeId: 'route-1', stepId: 'completed-step', routeVersion: 1,
      processCode: 'DONE', processName: '已完成工序', stageGroup: 'frontend', position: 1, sequenceGroup: 1,
      standardSource: 'legacy', timeBasis: 'per_unit', unitLabel: '件', standardMillisecondsPerUnit: 500,
      setupMilliseconds: 0, unitsPerProduct: 1, countsForEfficiency: true,
      productTimeProfileId: null, productTimeProfileVersion: null, plannedQty: 10, availableQty: 0,
      priority: 10, priorityReason: null, riskWarnings: null, status: DailyProcessTaskStatus.COMPLETED,
      sortOrder: 1, version: 0, createdAt: date, plan,
      assignments: [{
        id: 'completed-assignment', quantity: 10, plannedStandardMilliseconds: 5_000n,
        status: DailyTaskAssignmentStatus.COMPLETED, version: 0,
      }],
    },
    {
      id: 'normal-target-task', planId: 'plan-1', workDate: date, shiftCode: 'DAY', productionPlanBatchId: 'batch-1',
      workOrderId: 'work-order-1', routeId: 'route-1', stepId: 'normal-target', routeVersion: 1,
      processCode: 'TARGET', processName: '正常目标', stageGroup: 'frontend', position: 2, sequenceGroup: 2,
      standardSource: 'legacy', timeBasis: 'per_unit', unitLabel: '件', standardMillisecondsPerUnit: 1_000,
      setupMilliseconds: 0, unitsPerProduct: 1, countsForEfficiency: true,
      productTimeProfileId: null, productTimeProfileVersion: null, plannedQty: 10, availableQty: 10,
      priority: 10, priorityReason: null, riskWarnings: null, status: DailyProcessTaskStatus.READY,
      sortOrder: 2, version: 0, createdAt: new Date(date.getTime() + 1), plan,
      assignments: [{
        id: 'open-assignment', quantity: 10, plannedStandardMilliseconds: 10_000n,
        status: DailyTaskAssignmentStatus.PLANNED, version: 0,
      }],
    },
    {
      id: 'supplement-target-task', planId: 'plan-1', workDate: date, shiftCode: 'DAY', productionPlanBatchId: 'batch-1',
      workOrderId: 'work-order-1', routeId: 'route-1', stepId: 'supplement-target', routeVersion: 1,
      processCode: 'LATER', processName: '后续工序', stageGroup: 'backend', position: 3, sequenceGroup: 3,
      standardSource: 'legacy', timeBasis: 'per_unit', unitLabel: '件', standardMillisecondsPerUnit: 3_000,
      setupMilliseconds: 0, unitsPerProduct: 1, countsForEfficiency: true,
      productTimeProfileId: null, productTimeProfileVersion: null, plannedQty: 10, availableQty: 10,
      priority: 10, priorityReason: null, riskWarnings: null, status: DailyProcessTaskStatus.READY,
      sortOrder: 3, version: 0, createdAt: new Date(date.getTime() + 2), plan, assignments: [],
    },
  ];
  const route = {
    id: 'route-1', version: 2, workOrderId: 'work-order-1', productTimeProfileId: null, productTimeProfileVersion: null,
    steps: [
      {
        id: 'completed-step', processCode: 'DONE', processName: '已完成工序', stageGroup: 'frontend',
        position: 1, sequenceGroup: 1, standardSource: 'route_change', timeBasis: 'per_unit', unitLabel: '件',
        standardMillisecondsPerUnit: 9_999, setupMilliseconds: 0, unitsPerProduct: 1, countsForEfficiency: true,
        productTimeProfileId: null, productTimeProfileVersion: null, executionMode: ProcessStepExecutionMode.NORMAL,
        inputQty: 10, processedQty: 10, status: 'completed', supplementObligation: null,
      },
      {
        id: 'inserted-normal', processCode: 'NEW-N', processName: '新增正常工序', stageGroup: 'frontend',
        position: 2, sequenceGroup: 2, standardSource: 'route_change', timeBasis: 'per_unit', unitLabel: '件',
        standardMillisecondsPerUnit: 1_500, setupMilliseconds: 0, unitsPerProduct: 1, countsForEfficiency: true,
        productTimeProfileId: null, productTimeProfileVersion: null, executionMode: ProcessStepExecutionMode.NORMAL,
        inputQty: 10, processedQty: 0, status: 'current', supplementObligation: null,
      },
      {
        id: 'normal-target', processCode: 'TARGET', processName: '正常目标', stageGroup: 'frontend',
        position: 3, sequenceGroup: 3, standardSource: 'route_change', timeBasis: 'per_unit', unitLabel: '件',
        standardMillisecondsPerUnit: 2_000, setupMilliseconds: 0, unitsPerProduct: 1, countsForEfficiency: true,
        productTimeProfileId: null, productTimeProfileVersion: null, executionMode: ProcessStepExecutionMode.NORMAL,
        inputQty: 0, processedQty: 0, status: 'pending', supplementObligation: null,
      },
      {
        id: 'inserted-supplement', processCode: 'NEW-S', processName: '新增补充工序', stageGroup: 'backend',
        position: 4, sequenceGroup: 4, standardSource: 'route_change', timeBasis: 'per_unit', unitLabel: '件',
        standardMillisecondsPerUnit: 2_500, setupMilliseconds: 0, unitsPerProduct: 1, countsForEfficiency: true,
        productTimeProfileId: null, productTimeProfileVersion: null,
        executionMode: ProcessStepExecutionMode.SUPPLEMENTAL_OBLIGATION,
        inputQty: 0, processedQty: 0, status: 'current',
        supplementObligation: {
          status: ProcessSupplementObligationStatus.ACTIVE, requiredQty: 10, reportedQty: 0,
          insertBeforeStepId: 'supplement-target',
        },
      },
      {
        id: 'supplement-target', processCode: 'LATER', processName: '后续工序', stageGroup: 'backend',
        position: 5, sequenceGroup: 5, standardSource: 'route_change', timeBasis: 'per_unit', unitLabel: '件',
        standardMillisecondsPerUnit: 3_000, setupMilliseconds: 0, unitsPerProduct: 1, countsForEfficiency: true,
        productTimeProfileId: null, productTimeProfileVersion: null, executionMode: ProcessStepExecutionMode.NORMAL,
        inputQty: 10, processedQty: 0, status: 'current', supplementObligation: null,
      },
    ],
  };
  const revisions: Array<Record<string, unknown>> = [];
  let createdSequence = 0;
  const fakeTx = {
    workOrderProcessRoute: {
      findUnique: async () => structuredClone(route),
    },
    dailyProcessTask: {
      findMany: async () => structuredClone(tasks),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const task = tasks.find(item => (
          item.id === where.id && item.version === where.version && item.status === where.status
        ));
        if (!task) return { count: 0 };
        applyMutation(task as unknown as Record<string, unknown>, data);
        return { count: 1 };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdSequence += 1;
        const task = {
          ...data,
          id: `created-${createdSequence}`,
          version: 0,
          createdAt: new Date(date.getTime() + 100 + createdSequence),
          plan,
          assignments: [],
        } as unknown as FakeTask;
        tasks.push(task);
        return { id: task.id };
      },
    },
    dailyTaskAssignment: {
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const assignment = tasks.flatMap(item => item.assignments).find(item => (
          item.id === where.id && item.version === where.version && item.status === where.status
        ));
        if (!assignment) return { count: 0 };
        applyMutation(assignment as unknown as Record<string, unknown>, data);
        return { count: 1 };
      },
    },
    dailyPlanRevision: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        revisions.push(data);
        return data;
      },
    },
    dailyProductionPlan: {
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (where.id !== 'plan-1' || where.version !== plan.version || where.status !== plan.status) return { count: 0 };
        applyMutation(plan as unknown as Record<string, unknown>, data);
        return { count: 1 };
      },
    },
  } as unknown as Prisma.TransactionClient;

  const input = {
    changeId: 'change-1',
    routeId: 'route-1',
    actorId: 'actor-1',
    insertedSteps: [
      { stepId: 'inserted-normal', insertBeforeStepId: 'normal-target' },
      { stepId: 'inserted-supplement', insertBeforeStepId: 'supplement-target' },
    ],
    timeChangedStepIds: ['normal-target'],
  } as const;
  const result = await syncDailyTasksAfterProcessRouteChange(fakeTx, input);
  assert.deepEqual(result, {
    createdTasks: 2,
    synchronizedTasks: 2,
    synchronizedAssignments: 1,
    preservedHistoricalTasks: 1,
    skippedFrozenPlans: 0,
  });
  const completed = tasks.find(task => task.id === 'completed-task')!;
  assert.equal(completed.routeVersion, 1);
  assert.equal(completed.standardMillisecondsPerUnit, 500);
  assert.equal(completed.assignments[0].plannedStandardMilliseconds, 5_000n);

  const normalTarget = tasks.find(task => task.id === 'normal-target-task')!;
  assert.equal(normalTarget.status, DailyProcessTaskStatus.WAITING_UPSTREAM);
  assert.equal(normalTarget.availableQty, 0);
  assert.equal(normalTarget.standardMillisecondsPerUnit, 2_000);
  assert.equal(normalTarget.assignments[0].plannedStandardMilliseconds, 20_000n);

  const normalInserted = tasks.find(task => task.stepId === 'inserted-normal')!;
  assert.equal(normalInserted.status, DailyProcessTaskStatus.READY);
  assert.equal(normalInserted.availableQty, 10);
  assert.ok(normalInserted.riskWarnings?.includes('PROCESS_ROUTE_CHANGE_NEW'));

  const supplementInserted = tasks.find(task => task.stepId === 'inserted-supplement')!;
  assert.equal(supplementInserted.status, DailyProcessTaskStatus.WAITING_UPSTREAM);
  assert.equal(supplementInserted.availableQty, 0);
  assert.ok(supplementInserted.riskWarnings?.includes('PROCESS_SUPPLEMENT_OBLIGATION'));
  assert.ok(supplementInserted.riskWarnings?.includes('ZERO_MATERIAL_FLOW'));
  assert.equal(plan.version, 5);
  assert.equal(revisions.length, 4);

  const replay = await syncDailyTasksAfterProcessRouteChange(fakeTx, input);
  assert.deepEqual(replay, {
    createdTasks: 0,
    synchronizedTasks: 0,
    synchronizedAssignments: 0,
    preservedHistoricalTasks: 1,
    skippedFrozenPlans: 0,
  });
  assert.equal(tasks.length, 5);
  assert.equal(revisions.length, 4);
  assert.equal(plan.version, 5);
});
