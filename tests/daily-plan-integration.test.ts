import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  DailyCrossTeamRequestStatus,
  DailyProcessTaskStatus,
  DailyProductionPlanStatus,
  DailyTaskAssignmentStatus,
  LaborAccessRole,
  ProductionPlanningRole,
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import { formatWorkDate, normalizeWorkDate } from '../lib/daily-plan-domain';
import { productionPlanningDateBoundary } from '../lib/production-planning-date';
import {
  assignDailyProcessTask,
  carryOverDailyProcessTask,
  createDailyProductionPlan,
  DailyPlanServiceError,
  listDailyCrossTeamRequests,
  previewDailyPlanSuggestions,
  requestDailyCrossTeamAssignment,
  reviewDailyCrossTeamRequest,
  upsertProductionTeam,
  upsertProductionTeamProcessCapability,
} from '../lib/daily-plan-service';
import { completeProcessStep } from '../lib/process-completion-service';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';
const workDate = '2099-01-10';
const carryDate = '2099-01-11';

function integrationKey(prefix: string, label: string): string {
  return `${prefix}-${label}`;
}

function rejectionCode(result: PromiseRejectedResult): string | undefined {
  const reason = result.reason;
  return reason && typeof reason === 'object' && 'code' in reason
    ? String((reason as { code?: unknown }).code || '')
    : undefined;
}

function mutationResultVersion(value: unknown): number {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value) && 'version' in value);
  return Number((value as { version: unknown }).version);
}

async function createRouteFixture(prefix: string, label: string, actorId: string) {
  const now = new Date();
  const order = await prisma.workOrder.create({
    data: {
      code: `${prefix}-${label}`,
      customerName: 'daily-plan-postgresql-integration',
      productName: `${label} product`,
      stage: 'frontend',
      status: 'processing',
      processName: `${label} process`,
      uncompletedQty: '10',
      productionTargetQty: 10,
      completedQty: '0',
      frontendTransferredQty: 0,
      planType: 'managed_plan',
      planActive: true,
      startedAt: now,
      processRoute: {
        create: {
          templateName: `${prefix} ${label} route`,
          templateVersion: 1,
          status: 'in_progress',
          version: 0,
          confirmedAt: now,
          confirmedById: actorId,
          startedAt: now,
          routeSource: 'integration_test',
          steps: {
            create: {
              processCode: `${prefix}-${label}-STEP`,
              processName: `${label} process`,
              stageGroup: 'frontend',
              position: 1,
              sequenceGroup: 1,
              standardSource: 'integration_test',
              timeBasis: 'per_unit',
              unitLabel: 'piece',
              standardMillisecondsPerUnit: 1_000,
              setupMilliseconds: 0,
              unitsPerProduct: 1,
              countsForEfficiency: true,
              inputQty: 10,
              status: 'current',
              startedAt: now,
            },
          },
        },
      },
    },
    include: {
      processRoute: {
        include: { steps: true },
      },
    },
  });
  assert.ok(order.processRoute, 'fixture route must be created');
  assert.equal(order.processRoute.steps.length, 1);
  return {
    workOrderId: order.id,
    routeId: order.processRoute.id,
    step: order.processRoute.steps[0],
  };
}

async function createDailyTask(input: {
  planId: string;
  route: Awaited<ReturnType<typeof createRouteFixture>>;
  status?: DailyProcessTaskStatus;
}) {
  const { step } = input.route;
  const plan = await prisma.dailyProductionPlan.findUniqueOrThrow({
    where: { id: input.planId },
    select: { workDate: true, shiftCode: true },
  });
  return prisma.dailyProcessTask.create({
    data: {
      planId: input.planId,
      workDate: plan.workDate,
      shiftCode: plan.shiftCode,
      workOrderId: input.route.workOrderId,
      routeId: input.route.routeId,
      stepId: step.id,
      routeVersion: 0,
      processCode: step.processCode,
      processName: step.processName,
      stageGroup: step.stageGroup,
      position: step.position,
      sequenceGroup: step.sequenceGroup,
      standardSource: step.standardSource,
      timeBasis: step.timeBasis || 'per_unit',
      unitLabel: step.unitLabel || 'piece',
      standardMillisecondsPerUnit: step.standardMillisecondsPerUnit || 1_000,
      setupMilliseconds: step.setupMilliseconds,
      unitsPerProduct: step.unitsPerProduct,
      countsForEfficiency: step.countsForEfficiency,
      plannedQty: 10,
      availableQty: 10,
      status: input.status || DailyProcessTaskStatus.READY,
    },
  });
}

async function cleanup(prefix: string): Promise<void> {
  const [teams, users, employees, workOrders, processDefinitions, planOrders] = await Promise.all([
    prisma.productionTeam.findMany({ where: { code: { startsWith: prefix } }, select: { id: true } }),
    prisma.user.findMany({ where: { username: { startsWith: prefix } }, select: { id: true } }),
    prisma.employee.findMany({ where: { employeeNo: { startsWith: prefix } }, select: { id: true } }),
    prisma.workOrder.findMany({ where: { code: { startsWith: prefix } }, select: { id: true } }),
    prisma.processDefinition.findMany({ where: { code: { startsWith: prefix } }, select: { id: true } }),
    prisma.productionPlanOrder.findMany({ where: { sourceOrderNo: { startsWith: prefix } }, select: { id: true } }),
  ]);
  const teamIds = teams.map(item => item.id);
  const userIds = users.map(item => item.id);
  const employeeIds = employees.map(item => item.id);
  const workOrderIds = workOrders.map(item => item.id);
  const plans = teamIds.length
    ? await prisma.dailyProductionPlan.findMany({ where: { teamId: { in: teamIds } }, select: { id: true } })
    : [];
  const planIds = plans.map(item => item.id);
  const tasks = planIds.length
    ? await prisma.dailyProcessTask.findMany({ where: { planId: { in: planIds } }, select: { id: true } })
    : [];
  const taskIds = tasks.map(item => item.id);
  const routes = workOrderIds.length
    ? await prisma.workOrderProcessRoute.findMany({ where: { workOrderId: { in: workOrderIds } }, select: { id: true } })
    : [];
  const routeIds = routes.map(item => item.id);
  const completions = routeIds.length
    ? await prisma.processCompletion.findMany({ where: { routeId: { in: routeIds } }, select: { id: true } })
    : [];
  const completionIds = completions.map(item => item.id);
  const pools = completionIds.length
    ? await prisma.processLaborPool.findMany({ where: { completionId: { in: completionIds } }, select: { id: true } })
    : [];
  const poolIds = pools.map(item => item.id);

  if (taskIds.length) {
    await prisma.dailyCrossTeamRequest.deleteMany({ where: { taskId: { in: taskIds } } });
  }
  if (planIds.length) {
    await prisma.dailyPlanRevision.deleteMany({ where: { planId: { in: planIds } } });
  }
  if (taskIds.length) {
    await prisma.dailyTaskAssignment.deleteMany({ where: { taskId: { in: taskIds } } });
  }
  if (planIds.length) {
    await prisma.dailyProcessTask.deleteMany({ where: { planId: { in: planIds } } });
    await prisma.dailyCapacityOverride.deleteMany({ where: { planId: { in: planIds } } });
    await prisma.dailyProductionPlan.deleteMany({ where: { id: { in: planIds } } });
  }
  if (poolIds.length) {
    await prisma.processLaborClaim.deleteMany({ where: { poolId: { in: poolIds } } });
    await prisma.processLaborPool.deleteMany({ where: { id: { in: poolIds } } });
  }
  if (completionIds.length) {
    await prisma.processQuantityMovement.deleteMany({ where: { completionId: { in: completionIds } } });
  }
  const logTargetIds = [...workOrderIds, ...routeIds, ...completionIds, ...poolIds];
  if (logTargetIds.length) {
    await prisma.operationLog.deleteMany({ where: { targetId: { in: logTargetIds } } });
  }
  if (workOrderIds.length) {
    await prisma.workOrderProgressLog.deleteMany({ where: { workOrderId: { in: workOrderIds } } });
  }
  if (routeIds.length) {
    await prisma.processRouteActivity.deleteMany({ where: { routeId: { in: routeIds } } });
  }
  if (completionIds.length) {
    await prisma.processCompletion.deleteMany({ where: { id: { in: completionIds } } });
  }
  if (planOrders.length) {
    await prisma.productionPlanOrder.deleteMany({ where: { id: { in: planOrders.map(item => item.id) } } });
  }
  if (workOrderIds.length) {
    await prisma.workOrderProcessRoute.deleteMany({ where: { workOrderId: { in: workOrderIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: workOrderIds } } });
  }
  if (employeeIds.length || teamIds.length) {
    await prisma.productionPlanningMembership.deleteMany({
      where: {
        OR: [
          ...(employeeIds.length ? [{ employeeId: { in: employeeIds } }] : []),
          ...(teamIds.length ? [{ teamId: { in: teamIds } }] : []),
        ],
      },
    });
  }
  await prisma.dailyOrganizationMutation.deleteMany({
    where: { idempotencyKey: { startsWith: prefix } },
  });
  if (userIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  if (employeeIds.length) {
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
  }
  if (teamIds.length) {
    await prisma.productionTeam.deleteMany({ where: { id: { in: teamIds } } });
  }
  if (processDefinitions.length) {
    await prisma.processDefinition.deleteMany({ where: { id: { in: processDefinitions.map(item => item.id) } } });
  }
}

test(
  'real PostgreSQL daily planning preserves idempotency, concurrency, visibility, carry-over, and completion linkage',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured PostgreSQL database' },
  async t => {
    const prefix = `ITDP-${Date.now()}-${randomUUID().slice(0, 8)}`;
    let schemaReady = false;
    try {
      const database = await prisma.$queryRaw<Array<{
        database_name: string;
        server_version: string;
        daily_plan_table: string | null;
        organization_mutation_table: string | null;
      }>>`
        SELECT
          current_database() AS database_name,
          current_setting('server_version') AS server_version,
          to_regclass('public.daily_process_tasks')::text AS daily_plan_table,
          to_regclass('public.daily_organization_mutations')::text AS organization_mutation_table
      `;
      assert.ok(database[0]?.database_name, 'integration test must connect to PostgreSQL');
      assert.match(database[0].server_version, /^\d+/);
      assert.equal(
        database[0].daily_plan_table,
        'daily_process_tasks',
        'apply the daily production planning Prisma migration before running this test',
      );
      assert.equal(
        database[0].organization_mutation_table,
        'daily_organization_mutations',
        'apply the organization-mutation portion of the daily planning migration before running this test',
      );
      schemaReady = true;

      const [teamA, teamB, teamC] = await Promise.all([
        prisma.productionTeam.create({ data: { code: `${prefix}-A`, name: `${prefix} Team A` } }),
        prisma.productionTeam.create({ data: { code: `${prefix}-B`, name: `${prefix} Team B` } }),
        prisma.productionTeam.create({ data: { code: `${prefix}-C`, name: `${prefix} Team C` } }),
      ]);
      const [leaderEmployee, workerA1, workerA2, workerA3, workerB] = await Promise.all([
        prisma.employee.create({ data: { employeeNo: `${prefix}-LEAD-A`, name: `${prefix} leader A`, team: teamA.name } }),
        prisma.employee.create({ data: { employeeNo: `${prefix}-A1`, name: `${prefix} worker A1`, team: teamA.name } }),
        prisma.employee.create({ data: { employeeNo: `${prefix}-A2`, name: `${prefix} worker A2`, team: teamA.name } }),
        prisma.employee.create({ data: { employeeNo: `${prefix}-A3`, name: `${prefix} worker A3`, team: teamA.name } }),
        prisma.employee.create({ data: { employeeNo: `${prefix}-B1`, name: `${prefix} worker B1`, team: teamB.name } }),
      ]);
      const [admin, leaderA] = await Promise.all([
        prisma.user.create({
          data: {
            username: `${prefix}-admin`,
            passwordHash: 'integration-test-not-a-login-hash',
            displayName: `${prefix} administrator`,
            laborRole: LaborAccessRole.ADMIN,
          },
        }),
        prisma.user.create({
          data: {
            username: `${prefix}-leader-a`,
            passwordHash: 'integration-test-not-a-login-hash',
            displayName: `${prefix} leader A`,
            laborRole: LaborAccessRole.EMPLOYEE,
            employeeId: leaderEmployee.id,
          },
        }),
      ]);
      const effectiveFrom = new Date('2099-01-01T00:00:00.000Z');
      await prisma.productionPlanningMembership.createMany({
        data: [
          {
            employeeId: leaderEmployee.id,
            teamId: teamA.id,
            role: ProductionPlanningRole.TEAM_LEADER,
            scopeKey: teamA.id,
            effectiveFrom,
          },
          ...[workerA1, workerA2, workerA3].map(employee => ({
            employeeId: employee.id,
            teamId: teamA.id,
            role: ProductionPlanningRole.MEMBER,
            scopeKey: teamA.id,
            effectiveFrom,
          })),
          {
            employeeId: workerB.id,
            teamId: teamB.id,
            role: ProductionPlanningRole.MEMBER,
            scopeKey: teamB.id,
            effectiveFrom,
          },
        ],
      });

      const [assignmentRoute, unrelatedRoute, completionRoute] = await Promise.all([
        createRouteFixture(prefix, 'ASSIGNMENT', admin.id),
        createRouteFixture(prefix, 'UNRELATED', admin.id),
        createRouteFixture(prefix, 'COMPLETION', admin.id),
      ]);
      const planDate = new Date(`${workDate}T00:00:00.000Z`);
      const [planA, planB] = await Promise.all([
        prisma.dailyProductionPlan.create({
          data: {
            workDate: planDate,
            shiftCode: 'DAY',
            teamId: teamA.id,
            status: DailyProductionPlanStatus.CONFIRMED,
            confirmedAt: new Date(),
            confirmedById: admin.id,
            createdById: admin.id,
            updatedById: admin.id,
          },
        }),
        prisma.dailyProductionPlan.create({
          data: {
            workDate: planDate,
            shiftCode: 'DAY',
            teamId: teamB.id,
            status: DailyProductionPlanStatus.CONFIRMED,
            confirmedAt: new Date(),
            confirmedById: admin.id,
            createdById: admin.id,
            updatedById: admin.id,
          },
        }),
      ]);
      const [assignmentTask, unrelatedTask, completionTask] = await Promise.all([
        createDailyTask({ planId: planA.id, route: assignmentRoute }),
        createDailyTask({ planId: planB.id, route: unrelatedRoute }),
        createDailyTask({ planId: planA.id, route: completionRoute }),
      ]);

      let requestAtoBId = '';
      let requestAtoCId = '';
      let requestBtoCId = '';
      await t.test('legacy Monday-noon plan batches appear on Monday and every later day of the same week', async () => {
        const route = await createRouteFixture(prefix, 'WEEK-BOUNDARY', admin.id);
        const planOrder = await prisma.productionPlanOrder.create({
          data: {
            sourceOrderNo: `${prefix}-WEEK-BOUNDARY`,
            sourceLineNo: 1,
            customerName: 'weekly boundary customer',
            productName: 'weekly boundary product',
            specification: 'weekly-boundary-specification',
            orderQuantity: 10,
            orderDate: new Date('2099-01-01T04:00:00.000Z'),
            customerDueDate: new Date('2099-01-10T04:00:00.000Z'),
            status: 'scheduled',
          },
        });
        await prisma.productionPlanBatch.create({
          data: {
            planOrderId: planOrder.id,
            batchNo: 1,
            quantity: 10,
            weekStartDate: new Date('2099-01-05T04:00:00.000Z'),
            weekEndDate: new Date('2099-01-11T04:00:00.000Z'),
            plannedCompletionDate: new Date('2099-01-10T04:00:00.000Z'),
            releaseState: 'active',
            workOrderId: route.workOrderId,
          },
        });

        const [monday, tuesday] = await Promise.all([
          previewDailyPlanSuggestions({ actorUserId: admin.id, workDate: '2099-01-05', shiftCode: 'DAY', teamId: teamA.id }),
          previewDailyPlanSuggestions({ actorUserId: admin.id, workDate: '2099-01-06', shiftCode: 'DAY', teamId: teamA.id }),
        ]);
        assert.deepEqual(monday.candidates.map(candidate => candidate.stepId), [route.step.id]);
        assert.deepEqual(tuesday.candidates.map(candidate => candidate.stepId), [route.step.id]);

        const created = await createDailyProductionPlan({
          actorUserId: admin.id,
          workDate: '2099-01-05',
          shiftCode: 'DAY',
          teamId: teamA.id,
          workOrderIds: [route.workOrderId],
          idempotencyKey: integrationKey(prefix, 'week-boundary-create'),
        });
        assert.equal(Number(created.createdTaskCount), 1);
        const tuesdayAfterPlanning = await previewDailyPlanSuggestions({
          actorUserId: admin.id,
          workDate: '2099-01-06',
          shiftCode: 'DAY',
          teamId: teamA.id,
        });
        assert.equal(tuesdayAfterPlanning.candidates.some(candidate => candidate.stepId === route.step.id), false);
        assert.equal(tuesdayAfterPlanning.blocked.some(item => item.stepId === route.step.id && item.reason === 'ALREADY_PLANNED'), true);
      });

      await t.test('replaying the same cross-team request is idempotent', async () => {
        const input = {
          actorUserId: admin.id,
          taskId: assignmentTask.id,
          targetTeamId: teamB.id,
          employeeId: workerB.id,
          quantity: 4,
          reason: 'PostgreSQL idempotency integration check',
          idempotencyKey: integrationKey(prefix, 'cross-team-replay'),
        };
        const first = await requestDailyCrossTeamAssignment(input);
        const replay = await requestDailyCrossTeamAssignment(input);
        assert.equal(replay.id, first.id);
        requestAtoBId = first.id;
        assert.equal(
          await prisma.dailyCrossTeamRequest.count({ where: { idempotencyKey: input.idempotencyKey } }),
          1,
        );
      });

      await t.test('concurrent over-allocation leaves at most one committed assignment', async () => {
        const attempts = await Promise.allSettled([
          assignDailyProcessTask({
            actorUserId: admin.id,
            taskId: assignmentTask.id,
            expectedVersion: 0,
            idempotencyKey: integrationKey(prefix, 'concurrent-a'),
            assignments: [{ employeeId: workerA1.id, quantity: 6 }],
          }),
          assignDailyProcessTask({
            actorUserId: admin.id,
            taskId: assignmentTask.id,
            expectedVersion: 0,
            idempotencyKey: integrationKey(prefix, 'concurrent-b'),
            assignments: [{ employeeId: workerA2.id, quantity: 6 }],
          }),
        ]);
        const fulfilled = attempts.filter(item => item.status === 'fulfilled');
        const rejected = attempts.filter((item): item is PromiseRejectedResult => item.status === 'rejected');
        assert.equal(fulfilled.length, 1, JSON.stringify(attempts));
        assert.equal(rejected.length, 1, JSON.stringify(attempts));
        assert.ok(
          [
            'DAILY_PLAN_CONCURRENCY_CONFLICT',
            'DAILY_PLAN_ASSIGNMENT_EXCEEDS_TASK',
            'DAILY_PLAN_VERSION_CONFLICT',
          ].includes(rejectionCode(rejected[0]) || ''),
          `unexpected rejection code: ${rejectionCode(rejected[0])}`,
        );
        const committed = await prisma.dailyTaskAssignment.aggregate({
          where: { taskId: assignmentTask.id, status: { not: DailyTaskAssignmentStatus.CANCELLED } },
          _sum: { quantity: true },
          _count: true,
        });
        assert.equal(committed._count, 1);
        assert.equal(committed._sum.quantity, 6);
      });

      await t.test('a stale task version rolls the whole assignment transaction back', async () => {
        const idempotencyKey = integrationKey(prefix, 'stale-version');
        await assert.rejects(
          assignDailyProcessTask({
            actorUserId: admin.id,
            taskId: assignmentTask.id,
            expectedVersion: 0,
            idempotencyKey,
            assignments: [{ employeeId: workerA3.id, quantity: 1 }],
          }),
          (error: unknown) => error instanceof DailyPlanServiceError
            && error.code === 'DAILY_PLAN_VERSION_CONFLICT',
        );
        assert.equal(
          await prisma.dailyTaskAssignment.count({
            where: { idempotencyKey: { startsWith: idempotencyKey } },
          }),
          0,
        );
      });

      await t.test('concurrent approvals cannot reserve more than the task remainder', async () => {
        const second = await requestDailyCrossTeamAssignment({
          actorUserId: admin.id,
          taskId: assignmentTask.id,
          targetTeamId: teamC.id,
          quantity: 4,
          reason: 'competes for the same four remaining units',
          idempotencyKey: integrationKey(prefix, 'cross-team-competing'),
        });
        requestAtoCId = second.id;
        const reviews = await Promise.allSettled([
          reviewDailyCrossTeamRequest({
            actorUserId: admin.id,
            requestId: requestAtoBId,
            expectedVersion: 0,
            decision: 'APPROVE',
            idempotencyKey: integrationKey(prefix, 'approve-cross-team-b'),
          }),
          reviewDailyCrossTeamRequest({
            actorUserId: admin.id,
            requestId: requestAtoCId,
            expectedVersion: 0,
            decision: 'APPROVE',
            idempotencyKey: integrationKey(prefix, 'approve-cross-team-c'),
          }),
        ]);
        const fulfilled = reviews.filter(item => item.status === 'fulfilled');
        const rejected = reviews.filter((item): item is PromiseRejectedResult => item.status === 'rejected');
        assert.equal(fulfilled.length, 1, JSON.stringify(reviews));
        assert.equal(rejected.length, 1, JSON.stringify(reviews));
        assert.ok(
          [
            'DAILY_PLAN_CONCURRENCY_CONFLICT',
            'DAILY_PLAN_CROSS_TEAM_APPROVAL_EXCEEDS_REMAINING',
          ].includes(rejectionCode(rejected[0]) || ''),
          `unexpected approval rejection code: ${rejectionCode(rejected[0])}`,
        );
        const [approved, activeAssignments, consumedCrossTeam] = await Promise.all([
          prisma.dailyCrossTeamRequest.aggregate({
            where: { taskId: assignmentTask.id, status: DailyCrossTeamRequestStatus.APPROVED },
            _sum: { quantity: true },
          }),
          prisma.dailyTaskAssignment.aggregate({
            where: { taskId: assignmentTask.id, status: { not: DailyTaskAssignmentStatus.CANCELLED } },
            _sum: { quantity: true },
          }),
          prisma.dailyTaskAssignment.aggregate({
            where: {
              taskId: assignmentTask.id,
              assignedTeamId: { not: teamA.id },
              status: { not: DailyTaskAssignmentStatus.CANCELLED },
            },
            _sum: { quantity: true },
          }),
        ]);
        const taskRemainder = 10 - (activeAssignments._sum.quantity || 0);
        const unconsumedApproved = (approved._sum.quantity || 0) - (consumedCrossTeam._sum.quantity || 0);
        assert.equal(approved._sum.quantity, 4);
        assert.ok(unconsumedApproved <= taskRemainder);
      });

      await t.test('cross-team listing honors team scope, exact planId, and the default current date', async () => {
        const unrelated = await requestDailyCrossTeamAssignment({
          actorUserId: admin.id,
          taskId: unrelatedTask.id,
          targetTeamId: teamC.id,
          quantity: 2,
          reason: 'must be invisible to Team A leader',
          idempotencyKey: integrationKey(prefix, 'unrelated-cross-team'),
        });
        requestBtoCId = unrelated.id;
        const visibleToLeader = await listDailyCrossTeamRequests({
          actorUserId: leaderA.id,
          workDate,
        });
        const leaderIds = visibleToLeader.map(item => item.id);
        assert.ok(leaderIds.includes(requestAtoBId));
        assert.ok(leaderIds.includes(requestAtoCId));
        assert.ok(!leaderIds.includes(requestBtoCId));

        const visibleToAdmin = await listDailyCrossTeamRequests({
          actorUserId: admin.id,
          workDate,
        });
        const adminIds = visibleToAdmin.map(item => item.id);
        assert.ok(adminIds.includes(requestAtoBId));
        assert.ok(adminIds.includes(requestBtoCId));

        const today = formatWorkDate(productionPlanningDateBoundary());
        const todayPlan = await prisma.dailyProductionPlan.create({
          data: {
            workDate: normalizeWorkDate(today),
            shiftCode: 'DAY',
            teamId: teamC.id,
            status: DailyProductionPlanStatus.CONFIRMED,
            confirmedAt: new Date(),
            confirmedById: admin.id,
            createdById: admin.id,
            updatedById: admin.id,
          },
        });
        const todayTask = await createDailyTask({ planId: todayPlan.id, route: unrelatedRoute });
        const currentDateRequest = await requestDailyCrossTeamAssignment({
          actorUserId: admin.id,
          taskId: todayTask.id,
          targetTeamId: teamA.id,
          quantity: 1,
          reason: 'must be returned only by the default current-date query',
          idempotencyKey: integrationKey(prefix, 'today-cross-team'),
        });

        const exactPlan = await listDailyCrossTeamRequests({
          actorUserId: admin.id,
          planId: planA.id,
          workDate: today,
        });
        const exactPlanIds = exactPlan.map(item => item.id);
        assert.ok(exactPlanIds.includes(requestAtoBId));
        assert.ok(exactPlanIds.includes(requestAtoCId));
        assert.ok(!exactPlanIds.includes(requestBtoCId));
        assert.ok(!exactPlanIds.includes(currentDateRequest.id));

        const defaultDate = await listDailyCrossTeamRequests({ actorUserId: admin.id });
        const defaultDateIds = defaultDate.map(item => item.id);
        assert.ok(defaultDateIds.includes(currentDateRequest.id));
        assert.ok(!defaultDateIds.includes(requestAtoBId));
        assert.ok(!defaultDateIds.includes(requestBtoCId));
      });

      await t.test('carry-over links one target task, cancels source assignments, and replays safely', async () => {
        const sourceBefore = await prisma.dailyProcessTask.findUniqueOrThrow({ where: { id: assignmentTask.id } });
        const input = {
          actorUserId: admin.id,
          taskId: assignmentTask.id,
          expectedVersion: sourceBefore.version,
          targetDate: carryDate,
          shiftCode: 'DAY',
          reason: 'integration carry-over',
          idempotencyKey: integrationKey(prefix, 'carry-over'),
        };
        const first = await carryOverDailyProcessTask(input);
        const replay = await carryOverDailyProcessTask(input);
        assert.equal(replay.carriedTaskId, first.carriedTaskId);
        const [sourceAfter, target, activeSourceAssignments, allTargets] = await Promise.all([
          prisma.dailyProcessTask.findUniqueOrThrow({ where: { id: assignmentTask.id } }),
          prisma.dailyProcessTask.findUniqueOrThrow({
            where: { id: first.carriedTaskId },
            include: { plan: true },
          }),
          prisma.dailyTaskAssignment.count({
            where: { taskId: assignmentTask.id, status: { not: DailyTaskAssignmentStatus.CANCELLED } },
          }),
          prisma.dailyProcessTask.count({ where: { carryOverFromTaskId: assignmentTask.id } }),
        ]);
        assert.equal(sourceAfter.status, DailyProcessTaskStatus.CARRIED_OVER);
        assert.equal(target.carryOverFromTaskId, assignmentTask.id);
        assert.equal(target.plan.workDate.toISOString().slice(0, 10), carryDate);
        assert.equal(activeSourceAssignments, 0);
        assert.equal(allTargets, 1);
      });

      await t.test('team upsert replays exactly and rejects payload or version conflicts', async () => {
        const idempotencyKey = integrationKey(prefix, 'organization-team-update');
        const input = {
          actorUserId: admin.id,
          teamId: teamA.id,
          code: teamA.code,
          name: `${prefix} Team A updated`,
          expectedVersion: 0,
          idempotencyKey,
        };
        const first = await upsertProductionTeam(input);
        const replay = await upsertProductionTeam(input);
        assert.equal(mutationResultVersion(first), 1);
        assert.equal(mutationResultVersion(replay), 1);
        assert.equal(
          (await prisma.productionTeam.findUniqueOrThrow({ where: { id: teamA.id } })).version,
          1,
        );
        assert.equal(
          await prisma.dailyOrganizationMutation.count({ where: { idempotencyKey } }),
          1,
        );
        await assert.rejects(
          upsertProductionTeam({ ...input, name: `${prefix} conflicting payload` }),
          (error: unknown) => error instanceof DailyPlanServiceError
            && error.code === 'DAILY_PLAN_IDEMPOTENCY_CONFLICT',
        );
        await assert.rejects(
          upsertProductionTeam({
            ...input,
            idempotencyKey: integrationKey(prefix, 'organization-team-stale-version'),
          }),
          (error: unknown) => error instanceof DailyPlanServiceError
            && error.code === 'DAILY_PLAN_VERSION_CONFLICT',
        );
        const stored = await prisma.productionTeam.findUniqueOrThrow({ where: { id: teamA.id } });
        assert.equal(stored.version, 1);
        assert.equal(stored.name, input.name);
      });

      await t.test('team process ownership replays safely and keeps optimistic versions', async () => {
        const processDefinition = await prisma.processDefinition.create({
          data: {
            code: `${prefix}-CAPABILITY`,
            name: `${prefix} capability process`,
            stageGroup: 'frontend',
          },
        });
        const input = {
          actorUserId: admin.id,
          teamId: teamA.id,
          processDefinitionId: processDefinition.id,
          idempotencyKey: integrationKey(prefix, 'capability-create'),
        };
        const first = await upsertProductionTeamProcessCapability(input) as { id: string; version: number; isActive: boolean };
        const replay = await upsertProductionTeamProcessCapability(input) as { id: string; version: number; isActive: boolean };
        assert.equal(replay.id, first.id);
        assert.equal(replay.version, first.version);
        assert.equal(await prisma.productionTeamProcessCapability.count({ where: { teamId: teamA.id, processDefinitionId: processDefinition.id } }), 1);

        const disabled = await upsertProductionTeamProcessCapability({
          ...input,
          capabilityId: first.id,
          isActive: false,
          expectedVersion: first.version,
          idempotencyKey: integrationKey(prefix, 'capability-disable'),
        }) as { id: string; version: number; isActive: boolean };
        assert.equal(disabled.id, first.id);
        assert.equal(disabled.version, first.version + 1);
        assert.equal(disabled.isActive, false);
      });

      await t.test('process completion updates the same-day task and records the completion link', async () => {
        const completion = await completeProcessStep({
          routeId: completionRoute.routeId,
          stepId: completionRoute.step.id,
          processedQty: 4,
          defectQty: 0,
          workDate,
          workStartedAt: `${workDate}T00:00:00.000Z`,
          workEndedAt: `${workDate}T01:00:00.000Z`,
          employeeIds: [workerA1.id],
          requireParticipants: true,
          idempotencyKey: integrationKey(prefix, 'process-completion'),
          expectedRouteVersion: 0,
          userId: admin.id,
          actor: admin.displayName,
        });
        const [taskAfter, revision] = await Promise.all([
          prisma.dailyProcessTask.findUniqueOrThrow({ where: { id: completionTask.id } }),
          prisma.dailyPlanRevision.findUnique({
            where: {
              idempotencyKey: `process-completion:${completion.completionId}:daily-task:${completionTask.id}`,
            },
          }),
        ]);
        assert.equal(taskAfter.status, DailyProcessTaskStatus.IN_PROGRESS);
        assert.equal(taskAfter.availableQty, 6);
        assert.equal(taskAfter.version, 1);
        assert.equal(revision?.action, 'PROCESS_COMPLETION_SYNC');
        assert.equal(
          (revision?.afterData as Record<string, unknown> | null)?.completionId,
          completion.completionId,
        );
      });
    } finally {
      if (schemaReady) await cleanup(prefix);
    }
  },
);
