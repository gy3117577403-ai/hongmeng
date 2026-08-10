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
import {
  compareWeeklyProcessRows,
  matchesWeeklyCompletionFilter,
  parseWeeklyCompletionFilter,
  parseWeeklyProcessSort,
  weeklyCompletionState,
  weeklyDueTone,
  weeklyProcessKey,
  weeklyProcessLabor,
  type WeeklyCompletionState,
  type WeeklyDueTone,
} from '@/lib/weekly-process-domain';
import {
  listWeeklyProcessWorkerPresets,
  resolveWeeklyProcessWorkerPreset,
} from '@/lib/weekly-process-worker-preset-service';
import { productionEmployeeWhere } from '@/lib/production-workforce';
import {
  productionTeamScopeWhere,
  type ProductionEntityScope,
} from '@/lib/production-access-scope';

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
  processKey: string;
  processCode: string;
  processName: string;
  stageGroup: string;
  position: number;
  sequenceGroup: number;
  processedQuantity: number;
  reportedQuantity: number;
  pendingCoverageQuantity: number;
  allocatedQuantity: number;
  remainingQuantity: number;
  plannedMinutes: number;
  completionState: WeeklyCompletionState;
  completionLabel: string;
  dueTone: WeeklyDueTone;
  totalLaborMilliseconds: string;
  completedLaborMilliseconds: string;
  remainingLaborMilliseconds: string;
  pendingLaborMilliseconds: string;
  unallocatedLaborMilliseconds: string;
  state: WeeklyProcessState;
  stateLabel: string;
  hardBlocked: boolean;
  warningCodes: string[];
  warnings: string[];
  eligibleTeams: Array<{ id: string; name: string }>;
  workerPresetScope: 'PROCESS' | 'STEP' | null;
  workerPresetVersion: number | null;
  preferredEmployees: Array<{
    id: string;
    employeeNo: string;
    name: string;
    team: string | null;
    position: string | null;
  }>;
  inactivePreferenceCount: number;
  allocations: Array<{
    taskId: string;
    workDate: string;
    teamId: string;
    teamName: string;
    plannedQuantity: number;
    employees: string[];
  }>;
};

type WeeklyProcessWorkingItem = Omit<
  WeeklyProcessOverviewItem,
  | 'totalLaborMilliseconds'
  | 'completedLaborMilliseconds'
  | 'remainingLaborMilliseconds'
  | 'pendingLaborMilliseconds'
  | 'unallocatedLaborMilliseconds'
> & {
  totalLaborMilliseconds: bigint;
  completedLaborMilliseconds: bigint;
  remainingLaborMilliseconds: bigint;
  pendingLaborMilliseconds: bigint;
  unallocatedLaborMilliseconds: bigint;
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

function completionLabel(state: WeeklyCompletionState): string {
  return ({
    NOT_STARTED: '未开始',
    IN_PROGRESS: '进行中',
    PENDING_COVERAGE: '已报待核销',
    COMPLETED: '已完成',
  })[state];
}

function serializeWorkingItem(item: WeeklyProcessWorkingItem): WeeklyProcessOverviewItem {
  return {
    ...item,
    totalLaborMilliseconds: item.totalLaborMilliseconds.toString(),
    completedLaborMilliseconds: item.completedLaborMilliseconds.toString(),
    remainingLaborMilliseconds: item.remainingLaborMilliseconds.toString(),
    pendingLaborMilliseconds: item.pendingLaborMilliseconds.toString(),
    unallocatedLaborMilliseconds: item.unallocatedLaborMilliseconds.toString(),
  };
}

function sumLabor(
  items: WeeklyProcessWorkingItem[],
  field:
    | 'totalLaborMilliseconds'
    | 'completedLaborMilliseconds'
    | 'remainingLaborMilliseconds'
    | 'pendingLaborMilliseconds'
    | 'unallocatedLaborMilliseconds',
): string {
  return items.reduce((total, item) => total + item[field], 0n).toString();
}

export async function getWeeklyProcessOverview(input: {
  weekDate: string | Date;
  teamId?: string;
  search?: string;
  state?: string;
  processKey?: string;
  completion?: string;
  sort?: string;
  productionScope?: ProductionEntityScope;
}) {
  const batchWeek = productionBatchWeekStartWindow(input.weekDate);
  const taskWeek = productionWeekDateBounds(input.weekDate);
  const teamWhere = input.productionScope
    ? productionTeamScopeWhere(input.productionScope)
    : null;
  const teamRestricted = input.productionScope?.level === 'TEAM';
  const [teams, batches, presets, employeeOptions] = await Promise.all([
    prisma.productionTeam.findMany({
      where: { isActive: true, ...(teamWhere || {}) },
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
    listWeeklyProcessWorkerPresets(input.weekDate),
    prisma.employee.findMany({
      where: productionEmployeeWhere(),
      orderBy: [{ employeeNo: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        employeeNo: true,
        name: true,
        department: true,
        position: true,
        team: true,
        attendanceEnabled: true,
      },
    }),
  ]);
  const batchIds = batches.map(batch => batch.id);
  const stepIds = unique(batches.flatMap(batch => (
    batch.workOrder?.processRoute?.steps.map(step => step.id) || []
  )));
  const [tasks, completionTotals] = await Promise.all([
    batchIds.length ? prisma.dailyProcessTask.findMany({
        where: {
          productionPlanBatchId: { in: batchIds },
          workDate: { gte: taskWeek.startDate, lt: taskWeek.endExclusiveDate },
          status: { notIn: [DailyProcessTaskStatus.CANCELLED, DailyProcessTaskStatus.CARRIED_OVER] },
          ...(teamWhere ? { plan: { team: teamWhere } } : {}),
        },
        include: {
          plan: { include: { team: true } },
          assignments: {
            where: { status: { not: 'CANCELLED' } },
            include: { employee: true },
          },
        },
        orderBy: [{ workDate: 'asc' }, { sortOrder: 'asc' }],
      }) : [],
    stepIds.length ? prisma.processCompletion.groupBy({
      by: ['stepId'],
      where: { stepId: { in: stepIds }, voidedAt: null },
      _sum: { processedQty: true, coveredQty: true },
    }) : [],
  ]);
  const taskMap = tasks.reduce((map, task) => {
    const key = `${task.productionPlanBatchId || ''}:${task.stepId}`;
    map.set(key, [...(map.get(key) || []), task]);
    return map;
  }, new Map<string, typeof tasks>());
  const completionTotalsByStep = new Map(completionTotals.map(total => [
    total.stepId,
    {
      reportedQuantity: total._sum.processedQty || 0,
      coveredQuantity: total._sum.coveredQty || 0,
      pendingCoverageQuantity: Math.max(
        0,
        (total._sum.processedQty || 0) - (total._sum.coveredQty || 0),
      ),
    },
  ]));
  const eligibleTeamsByProcess = new Map<string, Array<{ id: string; name: string }>>();
  for (const team of teams) {
    for (const capability of team.processCapabilities) {
      const current = eligibleTeamsByProcess.get(capability.processDefinitionId) || [];
      current.push({ id: team.id, name: team.name });
      eligibleTeamsByProcess.set(capability.processDefinitionId, current);
    }
  }
  const mappingConfigured = eligibleTeamsByProcess.size > 0;
  const items: WeeklyProcessWorkingItem[] = [];
  const today = productionDateKey(new Date());

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
      if (teamRestricted) continue;
      const code = !workOrder ? 'WORK_ORDER_NOT_READY' : !route ? 'MISSING_PROCESS_ROUTE' : 'PROCESS_ROUTE_NOT_PUBLISHED';
      items.push({
        id: `${batch.id}:route`,
        ...base,
        stepId: null,
        processDefinitionId: null,
        processKey: weeklyProcessKey({ processName: '工艺路线待维护' }),
        processCode: '',
        processName: '工艺路线待维护',
        stageGroup: '',
        position: 0,
        sequenceGroup: 0,
        processedQuantity: 0,
        reportedQuantity: 0,
        pendingCoverageQuantity: 0,
        allocatedQuantity: 0,
        remainingQuantity: batch.quantity,
        plannedMinutes: 0,
        completionState: 'NOT_STARTED',
        completionLabel: completionLabel('NOT_STARTED'),
        dueTone: weeklyDueTone({ dueDate: base.dueDate, today, completed: false }),
        totalLaborMilliseconds: 0n,
        completedLaborMilliseconds: 0n,
        remainingLaborMilliseconds: 0n,
        pendingLaborMilliseconds: 0n,
        unallocatedLaborMilliseconds: 0n,
        state: 'BLOCKED',
        stateLabel: stateLabel('BLOCKED'),
        hardBlocked: true,
        warningCodes: [code],
        warnings: [dailyPlanWarningText(code)],
        eligibleTeams: [],
        workerPresetScope: null,
        workerPresetVersion: null,
        preferredEmployees: [],
        inactivePreferenceCount: 0,
        allocations: [],
      });
      continue;
    }
    const activeSteps = route.steps.filter(step => step.status !== 'skipped');
    if (!activeSteps.length) {
      if (teamRestricted) continue;
      items.push({
        id: `${batch.id}:empty-route`,
        ...base,
        stepId: null,
        processDefinitionId: null,
        processKey: weeklyProcessKey({ processName: '工艺路线没有有效工序' }),
        processCode: '',
        processName: '工艺路线没有有效工序',
        stageGroup: '',
        position: 0,
        sequenceGroup: 0,
        processedQuantity: 0,
        reportedQuantity: 0,
        pendingCoverageQuantity: 0,
        allocatedQuantity: 0,
        remainingQuantity: batch.quantity,
        plannedMinutes: 0,
        completionState: 'NOT_STARTED',
        completionLabel: completionLabel('NOT_STARTED'),
        dueTone: weeklyDueTone({ dueDate: base.dueDate, today, completed: false }),
        totalLaborMilliseconds: 0n,
        completedLaborMilliseconds: 0n,
        remainingLaborMilliseconds: 0n,
        pendingLaborMilliseconds: 0n,
        unallocatedLaborMilliseconds: 0n,
        state: 'BLOCKED',
        stateLabel: stateLabel('BLOCKED'),
        hardBlocked: true,
        warningCodes: ['EMPTY_PROCESS_ROUTE'],
        warnings: [dailyPlanWarningText('EMPTY_PROCESS_ROUTE')],
        eligibleTeams: [],
        workerPresetScope: null,
        workerPresetVersion: null,
        preferredEmployees: [],
        inactivePreferenceCount: 0,
        allocations: [],
      });
      continue;
    }
    for (const step of activeSteps) {
      const eligibleTeams = step.processDefinitionId
        ? eligibleTeamsByProcess.get(step.processDefinitionId) || []
        : [];
      if (teamRestricted && eligibleTeams.length === 0) continue;
      if (input.teamId === '__UNASSIGNED__' && eligibleTeams.length > 0) continue;
      if (
        input.teamId
        && input.teamId !== '__UNASSIGNED__'
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
      const completionTotal = completionTotalsByStep.get(step.id) || {
        reportedQuantity: step.processedQty,
        coveredQuantity: step.processedQty,
        pendingCoverageQuantity: 0,
      };
      const reportedQuantity = Math.max(step.processedQty, completionTotal.reportedQuantity);
      const pendingCoverageQuantity = Math.max(0, completionTotal.pendingCoverageQuantity);
      const processKey = weeklyProcessKey(step);
      const workerPreset = resolveWeeklyProcessWorkerPreset(presets, {
        processKey,
        stepId: step.id,
      });
      const preferredEmployees = workerPreset?.employees
        .filter(employee => employee.isActive)
        .map(employee => ({
          id: employee.id,
          employeeNo: employee.employeeNo,
          name: employee.name,
          team: employee.team,
          position: employee.position,
        })) || [];
      const inactivePreferenceCount = workerPreset?.employees.filter(employee => !employee.isActive).length || 0;
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
      const stepCompletionState = weeklyCompletionState({
        batchQuantity: batch.quantity,
        processedQuantity: step.processedQty,
        reportedQuantity,
        pendingCoverageQuantity,
        stepStatus: step.status,
      });
      const completed = stepCompletionState === 'COMPLETED';
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
      const snapshot = processTimeReady(step) ? {
        timeBasis: step.timeBasis as 'per_unit' | 'per_batch',
        standardMillisecondsPerUnit: step.standardMillisecondsPerUnit || 0,
        setupMilliseconds: step.setupMilliseconds,
        unitsPerProduct: step.unitsPerProduct,
      } : null;
      const labor = weeklyProcessLabor({
        snapshot,
        batchQuantity: batch.quantity,
        processedQuantity: step.processedQty,
        reportedQuantity,
        pendingCoverageQuantity,
      });
      let plannedMilliseconds = 0n;
      if (remainingQuantity > 0 && processTimeReady(step)) {
        plannedMilliseconds = allocateIncrementalTaskLabor({
          snapshot: snapshot!,
          alreadyAssignedQuantity: Math.min(coveredQuantity, batch.quantity),
          quantities: [remainingQuantity],
        })[0];
      }
      items.push({
        id: `${batch.id}:${step.id}`,
        ...base,
        stepId: step.id,
        processDefinitionId: step.processDefinitionId,
        processKey,
        processCode: step.processCode,
        processName: step.processName,
        stageGroup: step.stageGroup,
        position: step.position,
        sequenceGroup: step.sequenceGroup,
        processedQuantity: step.processedQty,
        reportedQuantity,
        pendingCoverageQuantity,
        allocatedQuantity,
        remainingQuantity,
        plannedMinutes: Math.max(0, Math.round(Number(plannedMilliseconds) / 60_000)),
        completionState: stepCompletionState,
        completionLabel: completionLabel(stepCompletionState),
        dueTone: weeklyDueTone({ dueDate: base.dueDate, today, completed }),
        totalLaborMilliseconds: labor.total,
        completedLaborMilliseconds: labor.completed,
        remainingLaborMilliseconds: labor.remaining,
        pendingLaborMilliseconds: labor.pendingCoverage,
        unallocatedLaborMilliseconds: plannedMilliseconds,
        state,
        stateLabel: stateLabel(state),
        hardBlocked,
        warningCodes,
        warnings: warningCodes.map(dailyPlanWarningText),
        eligibleTeams,
        workerPresetScope: workerPreset?.scope || null,
        workerPresetVersion: workerPreset?.version ?? null,
        preferredEmployees,
        inactivePreferenceCount,
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
  const completionFilter = parseWeeklyCompletionFilter(input.completion);
  const processFilter = String(input.processKey || '').trim();
  const sort = parseWeeklyProcessSort(input.sort);
  const processBaseItems = items.filter(item => {
    if (stateFilter && stateFilter !== 'ALL' && item.state !== stateFilter) return false;
    if (!search) return true;
    return [item.workOrderCode, item.customerName, item.productName, item.specification, item.processName]
      .some(value => value.toLocaleLowerCase('zh-CN').includes(search));
  });
  const facetItems = processBaseItems.filter(item => (
    matchesWeeklyCompletionFilter(item.completionState, completionFilter)
  ));
  const processFacetMap = new Map<string, {
    key: string;
    processDefinitionId: string | null;
    name: string;
    total: number;
    completed: number;
    incomplete: number;
    affectedOrders: Set<string>;
    remainingLaborMilliseconds: bigint;
  }>();
  for (const item of processBaseItems) {
    const current = processFacetMap.get(item.processKey) || {
      key: item.processKey,
      processDefinitionId: item.processDefinitionId,
      name: item.processName,
      total: 0,
      completed: 0,
      incomplete: 0,
      affectedOrders: new Set<string>(),
      remainingLaborMilliseconds: 0n,
    };
    current.total += 1;
    if (item.completionState === 'COMPLETED') current.completed += 1;
    else current.incomplete += 1;
    current.affectedOrders.add(item.productionPlanBatchId);
    current.remainingLaborMilliseconds += item.remainingLaborMilliseconds;
    processFacetMap.set(item.processKey, current);
  }
  const processOptions = [...processFacetMap.values()]
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
    .map(option => {
      const processPreset = resolveWeeklyProcessWorkerPreset(presets, { processKey: option.key });
      return {
        key: option.key,
        processDefinitionId: option.processDefinitionId,
        name: option.name,
        total: option.total,
        completed: option.completed,
        incomplete: option.incomplete,
        affectedOrders: option.affectedOrders.size,
        remainingLaborMilliseconds: option.remainingLaborMilliseconds.toString(),
        preferredEmployeeCount: processPreset?.employees.filter(employee => employee.isActive).length || 0,
      };
    });
  const completionFacetItems = processBaseItems.filter(item => (
    !processFilter || item.processKey === processFilter
  ));
  const filteredItems = facetItems
    .filter(item => !processFilter || item.processKey === processFilter)
    .sort((left, right) => compareWeeklyProcessRows(left, right, sort));
  const completedItems = filteredItems.filter(item => item.completionState === 'COMPLETED');
  const incompleteItems = filteredItems.filter(item => item.completionState !== 'COMPLETED');
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
      completed: items.filter(item => item.completionState === 'COMPLETED').length,
      incomplete: items.filter(item => item.completionState !== 'COMPLETED').length,
      pendingCoverage: items.filter(item => item.completionState === 'PENDING_COVERAGE').length,
      unassignedOwnership: items.filter(item => item.stepId && item.eligibleTeams.length === 0).length,
    },
    teamOptions: teams.map(team => ({ id: team.id, name: team.name, capabilityCount: team.processCapabilities.length })),
    processOptions,
    employeeOptions,
    presets,
    activeFilters: {
      completion: completionFilter,
      processKey: processFilter,
      state: stateFilter || 'ALL',
      sort,
    },
    completionFacets: {
      total: completionFacetItems.length,
      incomplete: completionFacetItems.filter(item => item.completionState !== 'COMPLETED').length,
      completed: completionFacetItems.filter(item => item.completionState === 'COMPLETED').length,
    },
    filteredCount: filteredItems.length,
    filteredSummary: {
      processes: filteredItems.length,
      affectedOrders: new Set(filteredItems.map(item => item.productionPlanBatchId)).size,
      completed: completedItems.length,
      incomplete: incompleteItems.length,
      pendingCoverage: filteredItems.filter(item => item.completionState === 'PENDING_COVERAGE').length,
      totalLaborMilliseconds: sumLabor(filteredItems, 'totalLaborMilliseconds'),
      completedLaborMilliseconds: sumLabor(filteredItems, 'completedLaborMilliseconds'),
      remainingLaborMilliseconds: sumLabor(filteredItems, 'remainingLaborMilliseconds'),
      pendingLaborMilliseconds: sumLabor(filteredItems, 'pendingLaborMilliseconds'),
      unallocatedLaborMilliseconds: sumLabor(filteredItems, 'unallocatedLaborMilliseconds'),
    },
    items: filteredItems.map(serializeWorkingItem),
  };
}
