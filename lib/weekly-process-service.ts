import { DailyProcessTaskStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  allocateIncrementalTaskLabor,
  resolveDailyTaskAvailability,
} from '@/lib/daily-plan-domain';
import {
  dailyPlanWarningText,
  drawingReady,
} from '@/lib/daily-plan-readiness';
import {
  productionBatchWeekStartWindow,
  productionDateKey,
  productionWeekDateBounds,
} from '@/lib/production-week';
import { summarizeWeeklyProcessAllocation } from '@/lib/weekly-process-allocation';

export type WeeklyProcessState = 'READY' | 'REVIEW' | 'WAITING' | 'BLOCKED' | 'PARTIAL' | 'PLANNED' | 'COMPLETED';

export type WeeklyProcessOverviewItem = {
  id: string;
  productionPlanBatchId: string;
  workOrderId: string | null;
  workOrderCode: string;
  customerName: string;
  productName: string;
  specification: string;
  dueDate: string;
  batchQuantity: number;
  stepId: string | null;
  processDefinitionId: string | null;
  processCode: string;
  processName: string;
  stageGroup: string;
  position: number;
  sequenceGroup: number;
  processedQuantity: number;
  allocatedQuantity: number;
  remainingQuantity: number;
  plannedMinutes: number;
  state: WeeklyProcessState;
  stateLabel: string;
  hardBlocked: boolean;
  warningCodes: string[];
  warnings: string[];
  eligibleTeams: Array<{ id: string; name: string }>;
  allocations: Array<{
    taskId: string;
    workDate: string;
    teamId: string;
    teamName: string;
    plannedQuantity: number;
    employees: string[];
  }>;
};

function processTimeReady(step: {
  timeBasis: string | null;
  standardMillisecondsPerUnit: number | null;
  setupMilliseconds: number;
  unitsPerProduct: number;
}): boolean {
  return (step.timeBasis === 'per_unit' || step.timeBasis === 'per_batch')
    && Number.isSafeInteger(step.standardMillisecondsPerUnit)
    && Number(step.standardMillisecondsPerUnit) > 0
    && Number.isSafeInteger(step.setupMilliseconds)
    && step.setupMilliseconds >= 0
    && Number.isSafeInteger(step.unitsPerProduct)
    && step.unitsPerProduct > 0;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function stateLabel(state: WeeklyProcessState): string {
  return ({
    READY: '可安排',
    REVIEW: '开工前确认',
    WAITING: '等待上道',
    BLOCKED: '待维护',
    PARTIAL: '部分安排',
    PLANNED: '已安排',
    COMPLETED: '已完成',
  })[state];
}

export async function getWeeklyProcessOverview(input: {
  weekDate: string | Date;
  teamId?: string;
  search?: string;
  state?: string;
}) {
  const batchWeek = productionBatchWeekStartWindow(input.weekDate);
  const taskWeek = productionWeekDateBounds(input.weekDate);
  const [teams, batches] = await Promise.all([
    prisma.productionTeam.findMany({
      where: { isActive: true },
      include: {
        processCapabilities: {
          where: { isActive: true, processDefinition: { isActive: true } },
          select: { processDefinitionId: true },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.productionPlanBatch.findMany({
      where: {
        deletedAt: null,
        releaseState: { in: ['active', 'preparation'] },
        workOrderId: { not: null },
        weekStartDate: { gte: batchWeek.gte, lt: batchWeek.lt },
        planOrder: { deletedAt: null },
        workOrder: { is: { deletedAt: null } },
      },
      include: {
        planOrder: true,
        workOrder: {
          include: {
            materialTask: true,
            processRoute: {
              include: {
                steps: { orderBy: [{ sequenceGroup: 'asc' }, { position: 'asc' }] },
              },
            },
          },
        },
      },
      orderBy: [{ plannedCompletionDate: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);
  const batchIds = batches.map(batch => batch.id);
  const tasks = batchIds.length
    ? await prisma.dailyProcessTask.findMany({
        where: {
          productionPlanBatchId: { in: batchIds },
          workDate: { gte: taskWeek.startDate, lt: taskWeek.endExclusiveDate },
          status: { notIn: [DailyProcessTaskStatus.CANCELLED, DailyProcessTaskStatus.CARRIED_OVER] },
        },
        include: {
          plan: { include: { team: true } },
          assignments: {
            where: { status: { not: 'CANCELLED' } },
            include: { employee: true },
          },
        },
        orderBy: [{ workDate: 'asc' }, { sortOrder: 'asc' }],
      })
    : [];
  const taskMap = tasks.reduce((map, task) => {
    const key = `${task.productionPlanBatchId || ''}:${task.stepId}`;
    map.set(key, [...(map.get(key) || []), task]);
    return map;
  }, new Map<string, typeof tasks>());
  const eligibleTeamsByProcess = new Map<string, Array<{ id: string; name: string }>>();
  for (const team of teams) {
    for (const capability of team.processCapabilities) {
      const current = eligibleTeamsByProcess.get(capability.processDefinitionId) || [];
      current.push({ id: team.id, name: team.name });
      eligibleTeamsByProcess.set(capability.processDefinitionId, current);
    }
  }
  const mappingConfigured = eligibleTeamsByProcess.size > 0;
  const items: WeeklyProcessOverviewItem[] = [];

  for (const batch of batches) {
    const workOrder = batch.workOrder;
    const route = workOrder?.processRoute;
    const base = {
      productionPlanBatchId: batch.id,
      workOrderId: workOrder?.id || null,
      workOrderCode: workOrder?.code || batch.planOrder.specification,
      customerName: batch.planOrder.customerName,
      productName: batch.planOrder.productName,
      specification: batch.planOrder.specification,
      dueDate: productionDateKey(batch.plannedCompletionDate),
      batchQuantity: batch.quantity,
    };
    if (!workOrder || !route || !['confirmed', 'in_progress', 'completed'].includes(route.status)) {
      const code = !workOrder ? 'WORK_ORDER_NOT_READY' : !route ? 'MISSING_PROCESS_ROUTE' : 'PROCESS_ROUTE_NOT_PUBLISHED';
      items.push({
        id: `${batch.id}:route`,
        ...base,
        stepId: null,
        processDefinitionId: null,
        processCode: '',
        processName: '工艺路线待维护',
        stageGroup: '',
        position: 0,
        sequenceGroup: 0,
        processedQuantity: 0,
        allocatedQuantity: 0,
        remainingQuantity: batch.quantity,
        plannedMinutes: 0,
        state: 'BLOCKED',
        stateLabel: stateLabel('BLOCKED'),
        hardBlocked: true,
        warningCodes: [code],
        warnings: [dailyPlanWarningText(code)],
        eligibleTeams: [],
        allocations: [],
      });
      continue;
    }
    const activeSteps = route.steps.filter(step => step.status !== 'skipped');
    if (!activeSteps.length) {
      items.push({
        id: `${batch.id}:empty-route`,
        ...base,
        stepId: null,
        processDefinitionId: null,
        processCode: '',
        processName: '工艺路线没有有效工序',
        stageGroup: '',
        position: 0,
        sequenceGroup: 0,
        processedQuantity: 0,
        allocatedQuantity: 0,
        remainingQuantity: batch.quantity,
        plannedMinutes: 0,
        state: 'BLOCKED',
        stateLabel: stateLabel('BLOCKED'),
        hardBlocked: true,
        warningCodes: ['EMPTY_PROCESS_ROUTE'],
        warnings: [dailyPlanWarningText('EMPTY_PROCESS_ROUTE')],
        eligibleTeams: [],
        allocations: [],
      });
      continue;
    }
    for (const step of activeSteps) {
      const eligibleTeams = step.processDefinitionId
        ? eligibleTeamsByProcess.get(step.processDefinitionId) || []
        : [];
      if (input.teamId === '__UNASSIGNED__' && eligibleTeams.length > 0) continue;
      if (
        input.teamId
        && input.teamId !== '__UNASSIGNED__'
        && eligibleTeams.length > 0
        && !eligibleTeams.some(team => team.id === input.teamId)
      ) continue;
      const itemTasks = taskMap.get(`${batch.id}:${step.id}`) || [];
      const allocation = summarizeWeeklyProcessAllocation({
        batchQuantity: batch.quantity,
        processedQuantity: step.processedQty,
        plannedQuantities: itemTasks.map(task => task.plannedQty),
      });
      const allocatedQuantity = allocation.allocatedQuantity;
      const coveredQuantity = allocation.coveredQuantity;
      const remainingQuantity = allocation.remainingQuantity;
      const availability = resolveDailyTaskAvailability({
        sequenceGroup: step.sequenceGroup,
        inputQty: step.inputQty,
        processedQty: step.processedQty,
      });
      const warningCodes = unique([
        ...(!processTimeReady(step) ? ['MISSING_PROCESS_TIME'] : []),
        ...(!drawingReady(workOrder) ? ['DRAWING_NOT_READY'] : []),
        ...(workOrder.materialTask?.status !== 'completed' ? ['MATERIAL_NOT_READY'] : []),
        ...(workOrder.materialTask?.exceptionType || workOrder.materialTask?.status === 'exception' ? ['WAREHOUSE_EXCEPTION'] : []),
        ...(availability.status === 'WAITING_UPSTREAM' ? ['WAITING_UPSTREAM'] : []),
      ]);
      const hardBlocked = warningCodes.includes('MISSING_PROCESS_TIME');
      const completed = step.status === 'completed' || step.processedQty >= batch.quantity;
      const state: WeeklyProcessState = completed
        ? 'COMPLETED'
        : hardBlocked
          ? 'BLOCKED'
          : allocatedQuantity >= batch.quantity
            ? 'PLANNED'
            : allocatedQuantity > 0
              ? 'PARTIAL'
              : warningCodes.includes('DRAWING_NOT_READY')
                ? 'REVIEW'
              : availability.status === 'WAITING_UPSTREAM'
                ? 'WAITING'
                : 'READY';
      let plannedMilliseconds = 0n;
      if (remainingQuantity > 0 && processTimeReady(step)) {
        plannedMilliseconds = allocateIncrementalTaskLabor({
          snapshot: {
            timeBasis: step.timeBasis as 'per_unit' | 'per_batch',
            standardMillisecondsPerUnit: step.standardMillisecondsPerUnit || 0,
            setupMilliseconds: step.setupMilliseconds,
            unitsPerProduct: step.unitsPerProduct,
          },
          alreadyAssignedQuantity: Math.min(coveredQuantity, batch.quantity),
          quantities: [remainingQuantity],
        })[0];
      }
      items.push({
        id: `${batch.id}:${step.id}`,
        ...base,
        stepId: step.id,
        processDefinitionId: step.processDefinitionId,
        processCode: step.processCode,
        processName: step.processName,
        stageGroup: step.stageGroup,
        position: step.position,
        sequenceGroup: step.sequenceGroup,
        processedQuantity: step.processedQty,
        allocatedQuantity,
        remainingQuantity,
        plannedMinutes: Math.max(0, Math.round(Number(plannedMilliseconds) / 60_000)),
        state,
        stateLabel: stateLabel(state),
        hardBlocked,
        warningCodes,
        warnings: warningCodes.map(dailyPlanWarningText),
        eligibleTeams,
        allocations: itemTasks.map(task => ({
          taskId: task.id,
          workDate: productionDateKey(task.workDate),
          teamId: task.plan.teamId,
          teamName: task.plan.team.name,
          plannedQuantity: task.plannedQty,
          employees: unique(task.assignments.map(assignment => assignment.employee.name)),
        })),
      });
    }
  }

  const search = String(input.search || '').trim().toLocaleLowerCase('zh-CN');
  const stateFilter = String(input.state || '').trim().toUpperCase();
  const filteredItems = items.filter(item => {
    if (stateFilter && stateFilter !== 'ALL' && item.state !== stateFilter) return false;
    if (!search) return true;
    return [item.workOrderCode, item.customerName, item.productName, item.specification, item.processName]
      .some(value => value.toLocaleLowerCase('zh-CN').includes(search));
  });
  return {
    generatedAt: new Date().toISOString(),
    weekStartDate: taskWeek.startKey,
    weekEndDate: taskWeek.endKey,
    mappingConfigured,
    summary: {
      total: items.length,
      ready: items.filter(item => item.state === 'READY' || item.state === 'REVIEW' || item.state === 'WAITING').length,
      planned: items.filter(item => item.state === 'PLANNED' || item.state === 'PARTIAL').length,
      blocked: items.filter(item => item.state === 'BLOCKED').length,
      completed: items.filter(item => item.state === 'COMPLETED').length,
      unassignedOwnership: items.filter(item => item.stepId && item.eligibleTeams.length === 0).length,
    },
    teamOptions: teams.map(team => ({ id: team.id, name: team.name, capabilityCount: team.processCapabilities.length })),
    filteredCount: filteredItems.length,
    items: filteredItems,
  };
}
