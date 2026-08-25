import { DailyProcessTaskStatus, DailyProductionPlanStatus, DailyTaskAssignmentStatus, Prisma } from '@prisma/client';
import { isInvalidSpecification } from '@/lib/drawing-library';
import { prisma } from '@/lib/prisma';
import { productionPlanAttainment } from '@/lib/production-plan-attainment';
import {
  productionTeamScopeWhere,
  type ProductionEntityScope,
} from '@/lib/production-access-scope';
import { getProductionAlerts, isDrawingConfirmationAlert } from '@/lib/production-alerts';
import { hasEffectiveIssuedDrawing } from '@/lib/production-drawing-readiness';
import { calculateProductionLaborProgress, serializeProductionLaborProgress } from '@/lib/production-labor-progress';
import { getProductionQuantitySummary, parsedImportedProductionTarget } from '@/lib/production-quantity';
import { processRouteSummaryInclude, serializeProcessRoute } from '@/lib/process-routing';
import { resolveEffectiveFrontendTransferredQty } from '@/lib/production-stage-flow';
import {
  activeProductionCarryoverWorkOrderWhere,
  loadProductionCarryoverCounts,
  loadProductionCarryoverMetadata,
  type ProductionCarryoverMetadata,
} from '@/lib/production-carryovers';
import { addDays, parseWeek } from '@/lib/weekly-work-orders';
import { normalizeWorkOrderStage, stageText, type WorkOrderStage } from '@/lib/work-orders';
import {
  productionArrangementCrossesWeek,
  resolveProductionArrangementProgress,
  type ProductionArrangementDisplayStatus,
} from '@/lib/production-arrangement-domain';

export const PRODUCTION_CATEGORY_CODES = ['drawing', 'sop', 'product', 'material', 'notice'] as const;

export const productionExecutionInclude = Prisma.validator<Prisma.WorkOrderInclude>()({
  drawingLibraryItem: {
    select: {
      id: true,
      files: {
        where: { deletedAt: null },
        select: { category: { select: { code: true } } },
      },
    },
  },
  progressLogs: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { createdBy: true },
  },
  materialTask: {
    select: {
      id: true,
      status: true,
      exceptionType: true,
      exceptionNote: true,
      expectedAt: true,
      completedAt: true,
      updatedAt: true,
    },
  },
  processRoute: {
    include: processRouteSummaryInclude,
  },
  parentWorkOrder: {
    select: { id: true, code: true },
  },
  branchWorkOrders: {
    where: { deletedAt: null },
    orderBy: [{ branchSequence: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      code: true,
      businessCode: true,
      branchType: true,
      branchStatus: true,
      productionTargetQty: true,
      processRoute: {
        select: {
          status: true,
          steps: {
            where: { status: 'current', retiredAt: null },
            orderBy: [{ sequenceGroup: 'asc' }, { position: 'asc' }],
            take: 1,
            select: { processName: true, unitLabel: true },
          },
        },
      },
    },
  },
  originStep: {
    select: { id: true, processName: true },
  },
  rejoinStep: {
    select: { id: true, processName: true },
  },
});

// List and dashboard calculations only need lightweight readiness relations.
// Keep execution/completion ledgers out of the broad scan; full route details
// are loaded only for the page of cards that will actually be rendered.
export const productionSummaryInclude = Prisma.validator<Prisma.WorkOrderInclude>()({
  drawingLibraryItem: {
    select: {
      id: true,
      files: {
        where: { deletedAt: null },
        select: { category: { select: { code: true } } },
      },
    },
  },
  materialTask: {
    select: {
      id: true,
      status: true,
      exceptionType: true,
      exceptionNote: true,
      expectedAt: true,
      completedAt: true,
      updatedAt: true,
    },
  },
  processRoute: {
    select: {
      steps: {
        where: { retiredAt: null },
        orderBy: { position: 'asc' },
        select: { status: true, sequenceGroup: true },
      },
    },
  },
});

export type ProductionExecutionOrderRecord = Prisma.WorkOrderGetPayload<{
  include: typeof productionExecutionInclude;
}>;

export type ProductionSummaryOrderRecord = Prisma.WorkOrderGetPayload<{
  include: typeof productionSummaryInclude;
}>;

type ProductionStatusOrderRecord = ProductionExecutionOrderRecord | ProductionSummaryOrderRecord;

export type ProductionExceptionCode =
  | 'overdue'
  | 'drawing_not_issued'
  | 'material_not_ready'
  | 'documents_incomplete'
  | 'delivery_missing'
  | 'specification_invalid'
  | 'customer_missing';

export type ProductionExecutionView = 'board' | 'today' | 'exceptions';
export type ProductionWeekScope = 'current' | 'carryover' | 'next' | 'afterNext' | 'history';

export type ProductionExecutionFilters = {
  workOrderId?: string;
  keyword?: string;
  quick?: string[];
  customers?: string[];
  duePreset?: string;
  dueFrom?: string;
  dueTo?: string;
  stage?: string;
  priority?: string;
  drawingStatus?: string;
  materialStatus?: string;
  documentCompleteness?: string;
};

export type ProductionWeek = {
  scope: ProductionWeekScope;
  weekStart: Date | null;
  weekEnd: Date | null;
};

export type ProductionWeekNavigation = {
  current: { weekStartDate: string; weekEndDate: string; count: number };
  next: { weekStartDate: string; weekEndDate: string; count: number };
  afterNext: { weekStartDate: string; weekEndDate: string; count: number };
  carryoverCount: number;
  olderCarryoverCount: number;
  history: Array<{ weekStartDate: string; weekEndDate: string; count: number }>;
};

function productionTeamWhere(scope?: ProductionEntityScope): Prisma.ProductionTeamWhereInput | null {
  return scope ? productionTeamScopeWhere(scope) as Prisma.ProductionTeamWhereInput | null : null;
}

export function productionWorkOrderScopeWhere(scope?: ProductionEntityScope): Prisma.WorkOrderWhereInput {
  const teamWhere = productionTeamWhere(scope);
  if (!teamWhere) return {};
  return {
    dailyProcessTasks: {
      some: {
        status: { not: DailyProcessTaskStatus.CANCELLED },
        plan: { team: teamWhere },
      },
    },
  };
}

function productionBatchScopeWhere(scope?: ProductionEntityScope): Prisma.ProductionPlanBatchWhereInput {
  const teamWhere = productionTeamWhere(scope);
  if (!teamWhere) return {};
  return {
    dailyProcessTasks: {
      some: {
        status: { not: DailyProcessTaskStatus.CANCELLED },
        plan: { team: teamWhere },
      },
    },
  };
}

const exceptionLabels: Record<ProductionExceptionCode, string> = {
  overdue: '已逾期',
  drawing_not_issued: '未发图',
  material_not_ready: '仓库异常',
  documents_incomplete: '原图或SOP缺失',
  delivery_missing: '交期缺失',
  specification_invalid: '规格异常',
  customer_missing: '客户缺失',
};

const validQuickFilters = new Set([
  'overdue', 'urgent', 'drawing', 'material', 'documents', 'completed',
  'due_today', 'updated_today', 'completed_today', 'delivery_missing',
  'specification_invalid', 'customer_missing', 'drawing_confirmation', 'tail_remaining',
  'due_soon', 'in_production', 'not_started', 'has_next_process', 'waiting_transfer',
  'arrangement_unassigned', 'arrangement_scheduled', 'arrangement_today', 'arrangement_overdue', 'arrangement_partial',
]);
const validStages = new Set(['not_issued', 'frontend', 'backend', 'completed']);
const validPriorities = new Set(['urgent', 'high', 'normal']);
const validDuePresets = new Set(['today', 'tomorrow', 'overdue', 'week', 'custom']);
const validDrawingStatuses = new Set(['issued', 'not_issued', 'sample_confirmation', 'customer_confirmation', 'change_required', 'confirmed', 'unset']);
const validMaterialStatuses = new Set(['pending', 'completed', 'exception', 'unset']);
const validDocumentCompleteness = new Set(['empty', 'partial', 'complete', 'incomplete']);

function validatedValue(value: string | null, allowed: Set<string>) {
  const normalized = text(value);
  return allowed.has(normalized) ? normalized : '';
}

function validatedDate(value: string | null) {
  const normalized = text(value);
  if (!normalized) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || !parseWeek(normalized)) throw new Error('交期日期格式不正确');
  return normalized;
}

export function parseProductionExecutionView(value: string | null): ProductionExecutionView {
  return value === 'today' || value === 'exceptions' ? value : 'board';
}

export function productionFiltersFromSearchParams(params: URLSearchParams): ProductionExecutionFilters {
  const customers = params.getAll('customer')
    .flatMap(value => value.split(','))
    .map(value => value.trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 30);
  const dueFrom = validatedDate(params.get('dueFrom') || params.get('deliveryFrom'));
  const dueTo = validatedDate(params.get('dueTo') || params.get('deliveryTo'));
  if (dueFrom && dueTo && dueFrom > dueTo) throw new Error('交期开始日期不能晚于结束日期');
  return {
    workOrderId: text(params.get('workOrderId')).slice(0, 120),
    keyword: text(params.get('keyword')).slice(0, 160),
    quick: (params.get('quick') || '').split(',').map(item => item.trim()).filter(item => validQuickFilters.has(item)),
    customers: [...new Set(customers)],
    duePreset: validatedValue(params.get('duePreset'), validDuePresets),
    dueFrom,
    dueTo,
    stage: validatedValue(params.get('stage'), validStages),
    priority: validatedValue(params.get('priority'), validPriorities),
    drawingStatus: validatedValue(params.get('drawing') || params.get('drawingStatus'), validDrawingStatuses),
    materialStatus: validatedValue(params.get('material') || params.get('materialStatus'), validMaterialStatuses),
    documentCompleteness: validatedValue(params.get('documents') || params.get('documentCompleteness') || params.get('completeness'), validDocumentCompleteness),
  };
}

function text(value?: string | null) {
  return value?.trim() || '';
}

function lower(value?: string | null) {
  return text(value).toLocaleLowerCase('zh-CN');
}

function chinaYmd(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const get = (type: string) => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export type ProductionArrangementWorker = {
  employeeId: string;
  employeeNo: string;
  name: string;
  quantity: number;
  plannedStandardMilliseconds: string;
};

export type ProductionArrangementView = {
  id: string;
  planId: string;
  workDate: string;
  shiftCode: string;
  teamId: string;
  teamName: string;
  planStatus: string;
  status: ProductionArrangementDisplayStatus;
  plannedQty: number;
  completedQty: number;
  defectQty: number;
  remainingQty: number;
  completedTaskCount: number;
  totalTaskCount: number;
  partial: boolean;
  overdue: boolean;
  crossWeek: boolean;
  continuable: boolean;
  taskIds: string[];
  sourceTaskIds: string[];
  processNames: string[];
  employees: ProductionArrangementWorker[];
};

export type ProductionArrangementMetrics = {
  unassigned: number;
  scheduled: number;
  today: number;
  overdue: number;
  partial: number;
};

function activeArrangement(arrangement: ProductionArrangementView): boolean {
  return arrangement.status !== 'completed' && arrangement.status !== 'carried_over';
}

function summarizeArrangementMetrics(
  orders: ProductionStatusOrderRecord[],
  arrangementsByOrder: Map<string, ProductionArrangementView[]>,
): ProductionArrangementMetrics {
  const today = chinaYmd(new Date());
  const metrics: ProductionArrangementMetrics = { unassigned: 0, scheduled: 0, today: 0, overdue: 0, partial: 0 };
  for (const order of orders.filter(isRootProductionOrder)) {
    const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
    const active = (arrangementsByOrder.get(order.id) || []).filter(activeArrangement);
    if (!active.length && stage !== 'completed') metrics.unassigned += 1;
    if (active.length) metrics.scheduled += 1;
    if (active.some(item => item.workDate === today)) metrics.today += 1;
    if (active.some(item => item.overdue)) metrics.overdue += 1;
    if (active.some(item => item.partial)) metrics.partial += 1;
  }
  return metrics;
}

async function loadProductionArrangementMap(
  orders: ProductionStatusOrderRecord[],
  now = new Date(),
  scope?: ProductionEntityScope,
): Promise<Map<string, ProductionArrangementView[]>> {
  const orderIds = orders.filter(isRootProductionOrder).map(order => order.id);
  const result = new Map<string, ProductionArrangementView[]>();
  if (!orderIds.length) return result;
  const tasks = await prisma.dailyProcessTask.findMany({
    where: {
      workOrderId: { in: orderIds },
      status: { not: DailyProcessTaskStatus.CANCELLED },
      ...(productionTeamWhere(scope) ? { plan: { team: productionTeamWhere(scope)! } } : {}),
    },
    include: {
      plan: { select: { id: true, status: true, teamId: true, team: { select: { name: true } } } },
      assignments: {
        where: { status: { not: DailyTaskAssignmentStatus.CANCELLED } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: { employee: { select: { id: true, employeeNo: true, name: true } } },
      },
    },
    orderBy: [{ workDate: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
  });
  if (!tasks.length) return result;
  const dates = tasks.map(task => task.workDate.getTime());
  const completions = await prisma.processCompletion.findMany({
    where: {
      workOrderId: { in: orderIds },
      voidedAt: null,
      workDate: { gte: new Date(Math.min(...dates)), lte: new Date(Math.max(...dates)) },
    },
    select: { workOrderId: true, stepId: true, workDate: true, processedQty: true, goodQty: true, defectQty: true },
  });
  const completionByTaskDate = completions.reduce((map, completion) => {
    const key = `${completion.workOrderId}:${completion.stepId}:${chinaYmd(completion.workDate)}`;
    const current = map.get(key) || { processedQty: 0, goodQty: 0, defectQty: 0 };
    current.processedQty += completion.processedQty;
    current.goodQty += completion.goodQty;
    current.defectQty += completion.defectQty;
    map.set(key, current);
    return map;
  }, new Map<string, { processedQty: number; goodQty: number; defectQty: number }>());
  const orderById = new Map(orders.map(order => [order.id, order] as const));
  const grouped = tasks.reduce((map, task) => {
    const key = `${task.workOrderId}:${task.planId}`;
    map.set(key, [...(map.get(key) || []), task]);
    return map;
  }, new Map<string, typeof tasks>());
  const today = chinaYmd(now);
  for (const groupTasks of grouped.values()) {
    const first = groupTasks[0];
    const workDate = chinaYmd(first.workDate);
    const order = orderById.get(first.workOrderId);
    if (!order) continue;
    const taskProgress = groupTasks.map(task => {
      const completion = completionByTaskDate.get(`${task.workOrderId}:${task.stepId}:${workDate}`)
        || { processedQty: 0, goodQty: 0, defectQty: 0 };
      const progress = resolveProductionArrangementProgress({
        workDate,
        today,
        plannedQty: task.plannedQty,
        completedQty: completion.goodQty,
        taskStatus: task.status,
      });
      return { task, completion, progress };
    });
    const nonCarried = taskProgress.filter(item => item.task.status !== DailyProcessTaskStatus.CARRIED_OVER);
    const relevant = nonCarried.length ? nonCarried : taskProgress;
    const completedTaskCount = taskProgress.filter(item => item.progress.completed).length;
    const plannedQty = Math.max(...taskProgress.map(item => item.task.plannedQty));
    const completedQty = relevant.length
      ? Math.min(...relevant.map(item => Math.min(item.task.plannedQty, item.completion.goodQty)))
      : 0;
    const defectQty = taskProgress.reduce((sum, item) => sum + item.completion.defectQty, 0);
    const allCarried = taskProgress.every(item => item.task.status === DailyProcessTaskStatus.CARRIED_OVER);
    const allCompleted = taskProgress.every(item => item.progress.completed);
    const partial = taskProgress.some(item => item.completion.goodQty > 0) && !allCompleted;
    const overdue = !allCarried && !allCompleted && workDate < today;
    const needsReview = first.plan.status === DailyProductionPlanStatus.NEEDS_REVIEW
      || taskProgress.some(item => item.task.status === DailyProcessTaskStatus.NEEDS_REVIEW);
    const status: ProductionArrangementDisplayStatus = allCarried
      ? 'carried_over'
      : allCompleted
        ? 'completed'
        : needsReview
          ? 'needs_review'
          : overdue
            ? 'overdue'
            : partial
              ? 'partial'
              : workDate === today
                ? 'today'
                : 'planned';
    const workerById = new Map<string, ProductionArrangementWorker>();
    for (const task of groupTasks) {
      for (const assignment of task.assignments) {
        const existing = workerById.get(assignment.employeeId);
        workerById.set(assignment.employeeId, {
          employeeId: assignment.employeeId,
          employeeNo: assignment.employee.employeeNo,
          name: assignment.employee.name,
          quantity: (existing?.quantity || 0) + assignment.quantity,
          plannedStandardMilliseconds: ((existing ? BigInt(existing.plannedStandardMilliseconds) : 0n) + assignment.plannedStandardMilliseconds).toString(),
        });
      }
    }
    const sourceTaskIds = taskProgress
      .filter(item => !item.progress.completed
        && item.task.status !== DailyProcessTaskStatus.CARRIED_OVER
        && item.task.status !== DailyProcessTaskStatus.CANCELLED
        && item.task.status !== DailyProcessTaskStatus.NEEDS_REVIEW)
      .map(item => item.task.id);
    const planAssignable = first.plan.status === DailyProductionPlanStatus.CONFIRMED
      || first.plan.status === DailyProductionPlanStatus.IN_PROGRESS;
    const arrangement: ProductionArrangementView = {
      id: first.planId,
      planId: first.planId,
      workDate,
      shiftCode: first.shiftCode,
      teamId: first.plan.teamId,
      teamName: first.plan.team.name,
      planStatus: first.plan.status,
      status,
      plannedQty,
      completedQty,
      defectQty,
      remainingQty: Math.max(0, plannedQty - completedQty),
      completedTaskCount,
      totalTaskCount: taskProgress.length,
      partial,
      overdue,
      crossWeek: productionArrangementCrossesWeek({
        workDate,
        weekStartDate: order.weekStartDate ? chinaYmd(order.weekStartDate) : null,
        weekEndDate: order.weekEndDate ? chinaYmd(order.weekEndDate) : null,
      }),
      continuable: planAssignable && workDate <= today && sourceTaskIds.length > 0,
      taskIds: taskProgress.map(item => item.task.id),
      sourceTaskIds,
      processNames: [...new Set(taskProgress.map(item => item.task.processName))],
      employees: [...workerById.values()],
    };
    result.set(first.workOrderId, [...(result.get(first.workOrderId) || []), arrangement]);
  }
  for (const arrangements of result.values()) {
    arrangements.sort((left, right) => left.workDate.localeCompare(right.workDate) || left.planId.localeCompare(right.planId));
  }
  return result;
}

export function chinaDayBounds(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const get = (type: string) => Number(parts.find(part => part.type === type)?.value || 0);
  const start = new Date(Date.UTC(get('year'), get('month') - 1, get('day'), -8));
  return { start, end: addDays(start, 1) };
}

function sameDayRange(date: Date) {
  return { gte: date, lt: addDays(date, 1) };
}

export function parseProductionWeekScope(value?: string | null): ProductionWeekScope {
  if (value === 'carryover' || value === 'next' || value === 'afterNext' || value === 'history') return value;
  return 'current';
}

export function naturalProductionWeek(now = new Date()): { start: Date; end: Date } {
  const dateText = chinaYmd(now);
  const localNoon = new Date(`${dateText}T12:00:00+08:00`);
  const day = localNoon.getUTCDay();
  const distance = day === 0 ? -6 : 1 - day;
  const date = parseWeek(dateText);
  if (!date) throw new Error('当前日期无法解析');
  const start = addDays(date, distance);
  return { start, end: addDays(start, 6) };
}

export async function resolveProductionWeek(
  weekStartInput?: string | null,
  weekEndInput?: string | null,
  scopeInput?: string | null,
): Promise<ProductionWeek> {
  const explicitScope = scopeInput === 'current'
    || scopeInput === 'carryover'
    || scopeInput === 'next'
    || scopeInput === 'afterNext'
    || scopeInput === 'history';
  const scope = explicitScope ? parseProductionWeekScope(scopeInput) : (weekStartInput ? 'history' : 'current');
  const natural = naturalProductionWeek();
  if (scope === 'current' || scope === 'carryover') {
    return { scope, weekStart: natural.start, weekEnd: natural.end };
  }
  if (scope === 'next' || scope === 'afterNext') {
    const offset = scope === 'afterNext' ? 14 : 7;
    return { scope, weekStart: addDays(natural.start, offset), weekEnd: addDays(natural.end, offset) };
  }
  const requestedStart = parseWeek(weekStartInput);
  if (weekStartInput && !requestedStart) throw new Error('周开始日期格式不正确');
  if (requestedStart) {
    const requestedEnd = parseWeek(weekEndInput) || addDays(requestedStart, 6);
    return { scope: 'history', weekStart: requestedStart, weekEnd: requestedEnd };
  }
  const previous = await prisma.productionPlanBatch.findFirst({
    where: {
      deletedAt: null,
      planOrder: { deletedAt: null },
      weekStartDate: { lt: natural.start },
    },
    select: { weekStartDate: true, weekEndDate: true },
    orderBy: [{ weekStartDate: 'desc' }, { updatedAt: 'desc' }],
  });
  return {
    scope: 'history',
    weekStart: previous?.weekStartDate || null,
    weekEnd: previous?.weekEndDate || (previous?.weekStartDate ? addDays(previous.weekStartDate, 6) : null),
  };
}

export function productionWeekWhere(week: ProductionWeek): Prisma.WorkOrderWhereInput {
  if (!week.weekStart) return { id: '__no_production_week__' };
  const base: Prisma.WorkOrderWhereInput = {
    deletedAt: null,
    planType: { in: ['weekly_plan', 'managed_plan'] },
  };
  if (week.scope === 'carryover') {
    return { ...base, weekStartDate: { lt: week.weekStart } };
  }
  const linkedProductionBatch: Prisma.WorkOrderWhereInput = {
    OR: [
      {
        productionPlanBatch: {
          is: { deletedAt: null, planOrder: { deletedAt: null } },
        },
      },
      {
        parentWorkOrder: {
          is: {
            productionPlanBatch: {
              is: { deletedAt: null, planOrder: { deletedAt: null } },
            },
          },
        },
      },
      {
        rootWorkOrder: {
          is: {
            productionPlanBatch: {
              is: { deletedAt: null, planOrder: { deletedAt: null } },
            },
          },
        },
      },
    ],
  };
  if (week.scope === 'current') {
    return {
      ...base,
      OR: [
        {
          AND: [
            linkedProductionBatch,
            { planActive: true },
            { weekStartDate: sameDayRange(week.weekStart) },
          ],
        },
        activeProductionCarryoverWorkOrderWhere(week.weekStart),
      ],
    };
  }
  return {
    ...base,
    ...linkedProductionBatch,
    ...(week.scope === 'next' || week.scope === 'afterNext' ? { planActive: false, planClearedAt: null } : {}),
    weekStartDate: sameDayRange(week.weekStart),
  };
}

export function productionRootWeekWhere(week: ProductionWeek): Prisma.WorkOrderWhereInput {
  return {
    ...productionWeekWhere(week),
    parentWorkOrderId: null,
  };
}

export async function loadProductionWeekNavigation(
  now = new Date(),
  scope?: ProductionEntityScope,
): Promise<ProductionWeekNavigation> {
  const natural = naturalProductionWeek(now);
  const nextStart = addDays(natural.start, 7);
  const afterNextStart = addDays(natural.start, 14);
  const planningBatchWhere = (weekStart: Date) => ({
    deletedAt: null,
    planOrder: { deletedAt: null },
    weekStartDate: sameDayRange(weekStart),
    ...productionBatchScopeWhere(scope),
  });
  const [currentCount, nextCount, afterNextCount, carryoverCounts, historicalBatches] = await Promise.all([
    prisma.productionPlanBatch.count({ where: planningBatchWhere(natural.start) }),
    prisma.productionPlanBatch.count({ where: planningBatchWhere(nextStart) }),
    prisma.productionPlanBatch.count({ where: planningBatchWhere(afterNextStart) }),
    loadProductionCarryoverCounts(natural.start, scope),
    prisma.productionPlanBatch.findMany({
      where: {
        deletedAt: null,
        planOrder: { deletedAt: null },
        weekStartDate: { lt: natural.start },
        ...productionBatchScopeWhere(scope),
      },
      select: { weekStartDate: true, weekEndDate: true },
      orderBy: { weekStartDate: 'desc' },
      take: 5000,
    }),
  ]);
  const historyMap = new Map<string, { weekStartDate: string; weekEndDate: string; count: number }>();
  for (const batch of historicalBatches) {
    const weekStartDate = chinaYmd(batch.weekStartDate);
    const current = historyMap.get(weekStartDate);
    if (current) current.count += 1;
    else historyMap.set(weekStartDate, {
      weekStartDate,
      weekEndDate: chinaYmd(batch.weekEndDate || addDays(batch.weekStartDate, 6)),
      count: 1,
    });
  }
  return {
    current: { weekStartDate: chinaYmd(natural.start), weekEndDate: chinaYmd(natural.end), count: currentCount },
    next: { weekStartDate: chinaYmd(nextStart), weekEndDate: chinaYmd(addDays(nextStart, 6)), count: nextCount },
    afterNext: { weekStartDate: chinaYmd(afterNextStart), weekEndDate: chinaYmd(addDays(afterNextStart, 6)), count: afterNextCount },
    carryoverCount: carryoverCounts.active,
    olderCarryoverCount: carryoverCounts.older,
    history: [...historyMap.values()],
  };
}

export function isMaterialReady(value?: string | null) {
  const normalized = text(value);
  return normalized.includes('已配料') || normalized.includes('料齐');
}

export function executionCompleteness(order: ProductionStatusOrderRecord) {
  const codes = new Set(order.drawingLibraryItem?.files.map(file => file.category.code) || []);
  const filled = PRODUCTION_CATEGORY_CODES.filter(code => codes.has(code)).length;
  return {
    filled,
    total: PRODUCTION_CATEGORY_CODES.length,
    text: `${filled}/${PRODUCTION_CATEGORY_CODES.length}`,
    complete: filled === PRODUCTION_CATEGORY_CODES.length,
  };
}

export function hasOriginalProductionDrawing(order: Pick<ProductionExecutionOrderRecord, 'drawingLibraryItem'>): boolean {
  const codes = new Set(order.drawingLibraryItem?.files.map(file => file.category.code) || []);
  return codes.has('drawing');
}

export function hasProductionSop(order: Pick<ProductionExecutionOrderRecord, 'drawingLibraryItem'>): boolean {
  const codes = new Set(order.drawingLibraryItem?.files.map(file => file.category.code) || []);
  return codes.has('sop');
}

export function hasRequiredProductionDocuments(order: Pick<ProductionExecutionOrderRecord, 'drawingLibraryItem'>): boolean {
  return hasOriginalProductionDrawing(order) && hasProductionSop(order);
}

export function productionExceptionCodes(order: ProductionStatusOrderRecord, now = new Date()): ProductionExceptionCode[] {
  const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
  const { start } = chinaDayBounds(now);
  const exceptions: ProductionExceptionCode[] = [];
  const alerts = getProductionAlerts({
    uncompletedQty: order.uncompletedQty,
    productionTargetQty: order.productionTargetQty,
    completedQty: order.completedQty,
    stage,
    specification: order.specification,
    specificationInvalid: !text(order.specification) || isInvalidSpecification(order.specification || ''),
    drawingStatus: order.drawingStatus,
    hasOriginalDrawing: hasOriginalProductionDrawing(order),
    materialStatus: order.materialStatus,
    warehouseMaterialStatus: order.materialTask?.status,
    warehouseExceptionType: order.materialTask?.exceptionType,
    warehouseExceptionNote: order.materialTask?.exceptionNote,
    warehouseExpectedAt: order.materialTask?.expectedAt,
    latestProgressRemark: order.latestProgressRemark,
    plannedAt: order.plannedAt,
  }, now);
  if (stage !== 'completed' && order.plannedAt && order.plannedAt < start) exceptions.push('overdue');
  if (alerts.some(alert => alert.code === 'DRAWING_NOT_ISSUED')) exceptions.push('drawing_not_issued');
  if (alerts.some(alert => alert.code === 'MATERIAL_NOT_READY')) exceptions.push('material_not_ready');
  if (!hasRequiredProductionDocuments(order)) exceptions.push('documents_incomplete');
  if (!order.plannedAt && !text(order.deliveryDay)) exceptions.push('delivery_missing');
  if (!text(order.specification) || isInvalidSpecification(order.specification || '')) exceptions.push('specification_invalid');
  if (!text(order.customerName)) exceptions.push('customer_missing');
  return exceptions;
}

export function serializeProductionOrder(
  order: ProductionExecutionOrderRecord,
  now = new Date(),
  carryover: ProductionCarryoverMetadata | null = null,
) {
  const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
  const completeness = executionCompleteness(order);
  const exceptionCodes = productionExceptionCodes(order, now);
  const quantitySummary = getProductionQuantitySummary({
    uncompletedQty: order.uncompletedQty,
    productionTargetQty: order.productionTargetQty,
    completedQty: order.completedQty,
    stage,
  });
  const standardLaborProgress = serializeProductionLaborProgress(calculateProductionLaborProgress({
    targetQuantity: quantitySummary.targetQty,
    steps: order.processRoute?.steps || [],
  }));
  const productionAlerts = getProductionAlerts({
    uncompletedQty: order.uncompletedQty,
    productionTargetQty: order.productionTargetQty,
    completedQty: order.completedQty,
    stage,
    specification: order.specification,
    specificationInvalid: !text(order.specification) || isInvalidSpecification(order.specification || ''),
    drawingStatus: order.drawingStatus,
    hasOriginalDrawing: hasOriginalProductionDrawing(order),
    materialStatus: order.materialStatus,
    warehouseMaterialStatus: order.materialTask?.status,
    warehouseExceptionType: order.materialTask?.exceptionType,
    warehouseExceptionNote: order.materialTask?.exceptionNote,
    warehouseExpectedAt: order.materialTask?.expectedAt,
    latestProgressRemark: order.latestProgressRemark,
    plannedAt: order.plannedAt,
  }, now);
  const flowResolution = resolveEffectiveFrontendTransferredQty(order);
  const importedTargetQty = parsedImportedProductionTarget(order.uncompletedQty);
  const quantityTargetSource = order.productionTargetQty !== null
    ? 'manual_override' as const
    : importedTargetQty !== null
      ? 'weekly_plan' as const
      : 'missing' as const;
  const quantityFlow = flowResolution.ok
    ? {
      valid: true as const,
      targetQty: flowResolution.state.targetQty,
      frontendTransferredQty: flowResolution.state.frontendTransferredQty,
      completedQty: flowResolution.state.completedQty,
      frontendRemainingQty: flowResolution.state.frontendRemainingQty,
      backendRemainingQty: flowResolution.state.backendRemainingQty,
      executionVersion: flowResolution.state.executionVersion,
      legacy: flowResolution.state.legacy,
      materialized: flowResolution.state.materialized,
      segments: flowResolution.state.segments,
      error: null,
    }
    : {
      valid: false as const,
      targetQty: quantitySummary.targetQty,
      frontendTransferredQty: order.frontendTransferredQty,
      completedQty: quantitySummary.completedQty,
      frontendRemainingQty: null,
      backendRemainingQty: null,
      executionVersion: order.executionVersion,
      legacy: order.frontendTransferredQty === null,
      materialized: order.frontendTransferredQty !== null,
      segments: [{ stage, quantity: null }],
      error: {
        code: flowResolution.error.code,
        field: flowResolution.error.field,
        message: flowResolution.error.message,
      },
    };
  return {
    id: order.id,
    code: order.code,
    businessCode: order.businessCode,
    specification: order.specification,
    customerName: order.customerName,
    productName: order.productName,
    stage,
    stageText: stageText[stage],
    priority: order.priority,
    plannedAt: order.plannedAt?.toISOString() || null,
    deliveryDay: order.deliveryDay,
    uncompletedQty: order.uncompletedQty,
    importedTargetQty,
    productionTargetQty: order.productionTargetQty,
    quantityTargetSource,
    productionOwner: order.productionOwner,
    workstation: order.workstation,
    completedQty: order.completedQty,
    frontendTransferredQty: order.frontendTransferredQty,
    executionVersion: order.executionVersion,
    parentWorkOrderId: order.parentWorkOrderId,
    parentWorkOrder: order.parentWorkOrder,
    branchWorkOrders: order.branchWorkOrders.map(branch => ({
      id: branch.id,
      code: branch.code,
      businessCode: branch.businessCode,
      branchType: branch.branchType,
      branchStatus: branch.branchStatus,
      productionTargetQty: branch.productionTargetQty,
      routeStatus: branch.processRoute?.status || null,
      currentProcessName: branch.processRoute?.steps[0]?.processName || null,
      unitLabel: branch.processRoute?.steps[0]?.unitLabel || null,
    })),
    rootWorkOrderId: order.rootWorkOrderId,
    branchType: order.branchType,
    branchStatus: order.branchStatus,
    originStep: order.originStep,
    rejoinStep: order.rejoinStep,
    branchSequence: order.branchSequence,
    quantityFlow,
    startedAt: order.startedAt?.toISOString() || null,
    completedAt: order.completedAt?.toISOString() || null,
    lastProgressAt: order.lastProgressAt?.toISOString() || null,
    latestProgressRemark: order.latestProgressRemark,
    lastProgressBy: order.progressLogs[0]?.createdBy || null,
    drawingStatus: order.drawingStatus,
    materialStatus: order.materialStatus,
    warehouseMaterial: order.materialTask ? {
      taskId: order.materialTask.id,
      status: order.materialTask.status,
      exceptionType: order.materialTask.exceptionType,
      exceptionNote: order.materialTask.exceptionNote,
      expectedAt: order.materialTask.expectedAt?.toISOString() || null,
      completedAt: order.materialTask.completedAt?.toISOString() || null,
      updatedAt: order.materialTask.updatedAt.toISOString(),
    } : null,
    processRoute: order.processRoute ? serializeProcessRoute(order.processRoute) : null,
    drawingLibraryItemId: order.drawingLibraryItemId,
    documentCategoryCodes: [...new Set(order.drawingLibraryItem?.files.map(file => file.category.code) || [])],
    documentCompleteness: completeness.text,
    documentFilledCount: completeness.filled,
    documentTotalCount: completeness.total,
    documentsComplete: completeness.complete,
    exceptionCodes,
    exceptionLabels: exceptionCodes.map(code => exceptionLabels[code]),
    quantitySummary,
    standardLaborProgress,
    productionAlerts,
    processName: order.processName,
    orderDate: order.orderDate?.toISOString() || null,
    salesperson: order.salesperson,
    customerLevel: order.customerLevel,
    sourceOrderNo: order.sourceOrderNo,
    importBatchId: order.importBatchId,
    sourceSheetName: order.sourceSheetName,
    sourceRowNo: order.sourceRowNo,
    drawingIssuedAt: order.drawingIssuedAt?.toISOString() || null,
    drawingIssueNote: order.drawingIssueNote,
    planActive: order.planActive,
    unitWorkHours: order.unitWorkHours,
    totalWorkHours: order.totalWorkHours,
    remark: order.remark,
    weekStartDate: order.weekStartDate?.toISOString() || null,
    weekEndDate: order.weekEndDate?.toISOString() || null,
    updatedAt: order.updatedAt.toISOString(),
    carryover,
  };
}

export function isRootProductionOrder(order: Pick<ProductionExecutionOrderRecord, 'parentWorkOrderId'>): boolean {
  return order.parentWorkOrderId === null;
}

function inChinaDay(value: Date | null | undefined, now = new Date()) {
  if (!value) return false;
  const { start, end } = chinaDayBounds(now);
  return value >= start && value < end;
}

function isDueToday(order: ProductionStatusOrderRecord, now = new Date()) {
  const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
  return stage !== 'completed' && inChinaDay(order.plannedAt, now);
}

function isOverdue(order: ProductionStatusOrderRecord, now = new Date()) {
  const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
  return stage !== 'completed' && !!order.plannedAt && order.plannedAt < chinaDayBounds(now).start;
}

function productionDeliveryDate(order: Pick<ProductionExecutionOrderRecord, 'deliveryDay' | 'plannedAt'>): Date | null {
  const deliveryDay = text(order.deliveryDay).match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  return (deliveryDay ? parseWeek(deliveryDay) : null) || order.plannedAt || null;
}

export function isProductionDueSoon(
  order: Pick<ProductionExecutionOrderRecord, 'stage' | 'status' | 'deliveryDay' | 'plannedAt'>,
  now = new Date(),
): boolean {
  const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
  if (stage === 'completed') return false;
  const delivery = productionDeliveryDate(order);
  if (!delivery) return false;
  const { start } = chinaDayBounds(now);
  return delivery >= start && delivery < addDays(start, 3);
}

export function hasNextProductionProcess(
  order: Pick<ProductionStatusOrderRecord, 'stage' | 'status' | 'processRoute'>,
): boolean {
  const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
  if (stage === 'completed' || !order.processRoute) return false;
  const currentGroups = order.processRoute.steps
    .filter(step => step.status === 'current')
    .map(step => step.sequenceGroup);
  const currentGroup = currentGroups.length ? Math.min(...currentGroups) : null;
  return order.processRoute.steps.some(step => (
    step.status === 'pending'
    && (currentGroup === null || step.sequenceGroup > currentGroup)
  ));
}

function isTodayTask(order: ProductionStatusOrderRecord, now = new Date()) {
  const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
  return isDueToday(order, now)
    || isOverdue(order, now)
    || (order.priority === 'urgent' && stage !== 'completed')
    || inChinaDay(order.lastProgressAt, now)
    || inChinaDay(order.completedAt, now);
}

function dateInput(value?: string) {
  if (!value) return null;
  return parseWeek(value);
}

function drawingStatusValue(order: ProductionStatusOrderRecord) {
  const value = text(order.drawingStatus);
  if ((!value || value === '-' || value.includes('未设置')) && hasEffectiveIssuedDrawing(value, hasOriginalProductionDrawing(order))) {
    return 'issued';
  }
  if (!value || value === '-' || value.includes('未设置')) return 'unset';
  if (value.includes('样品') && value.includes('确认')) return 'sample_confirmation';
  if (value.includes('客户') && value.includes('确认')) return 'customer_confirmation';
  if (value.includes('变更')) return 'change_required';
  if (value.includes('已确认')) return 'confirmed';
  if (value.includes('未发') || value.includes('未下发')) return 'not_issued';
  if (value.includes('已发') || value.includes('已下发')) return 'issued';
  return 'issued';
}

function materialStatusValue(order: ProductionStatusOrderRecord) {
  if (!order.materialTask) return 'unset';
  if (order.materialTask.status === 'pending') return 'pending';
  if (order.materialTask.status === 'completed') return 'completed';
  if (order.materialTask.status === 'exception') return 'exception';
  return 'unset';
}

function matchesDuePreset(order: ProductionStatusOrderRecord, preset: string | undefined, week: ProductionWeek, now: Date) {
  if (!preset) return true;
  const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
  const { start, end } = chinaDayBounds(now);
  if (preset === 'overdue') return stage !== 'completed' && !!order.plannedAt && order.plannedAt < start;
  if (!order.plannedAt) return false;
  if (preset === 'today') return order.plannedAt >= start && order.plannedAt < end;
  if (preset === 'tomorrow') return order.plannedAt >= end && order.plannedAt < addDays(end, 1);
  if (preset === 'week') return !!week.weekStart && order.plannedAt >= week.weekStart && order.plannedAt < addDays(week.weekEnd || addDays(week.weekStart, 6), 1);
  return true;
}

function matchesFilters(
  order: ProductionStatusOrderRecord,
  filters: ProductionExecutionFilters,
  week: ProductionWeek,
  arrangements: ProductionArrangementView[] = [],
  now = new Date(),
) {
  if (filters.workOrderId) return order.id === filters.workOrderId;
  const keyword = lower(filters.keyword);
  if (keyword) {
    const haystack = [order.specification, order.customerName, order.productName, order.code, order.sourceOrderNo, order.latestProgressRemark]
      .map(lower)
      .join('\n');
    if (!haystack.includes(keyword)) return false;
  }
  if (filters.customers?.length && !filters.customers.some(customer => lower(customer) === lower(order.customerName))) return false;
  const normalizedStage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
  const flowResolution = resolveEffectiveFrontendTransferredQty(order);
  const flowStages = flowResolution.ok ? flowResolution.state.segments.map(segment => segment.stage) : [normalizedStage];
  if (filters.stage && !flowStages.includes(normalizeWorkOrderStage(filters.stage) || normalizedStage)) return false;
  if (filters.priority && order.priority !== filters.priority) return false;
  if (!matchesDuePreset(order, filters.duePreset, week, now)) return false;
  const from = dateInput(filters.dueFrom);
  const to = dateInput(filters.dueTo);
  if (from && (!order.plannedAt || order.plannedAt < from)) return false;
  if (to && (!order.plannedAt || order.plannedAt >= addDays(to, 1))) return false;
  const completeness = executionCompleteness(order);
  if (filters.documentCompleteness === 'empty' && completeness.filled !== 0) return false;
  if (filters.documentCompleteness === 'partial' && (completeness.filled <= 0 || completeness.complete)) return false;
  if (filters.documentCompleteness === 'complete' && !completeness.complete) return false;
  if (filters.documentCompleteness === 'incomplete' && completeness.complete) return false;
  if (filters.drawingStatus && drawingStatusValue(order) !== filters.drawingStatus) return false;
  if (filters.materialStatus && materialStatusValue(order) !== filters.materialStatus) return false;

  const quick = (filters.quick || []).filter(item => item && item !== 'all');
  const productionAlerts = quick.some(item => item === 'drawing' || item === 'drawing_confirmation' || item === 'material' || item === 'tail_remaining')
    ? getProductionAlerts({
      uncompletedQty: order.uncompletedQty,
      productionTargetQty: order.productionTargetQty,
      completedQty: order.completedQty,
      stage: normalizedStage,
      specification: order.specification,
      specificationInvalid: !text(order.specification) || isInvalidSpecification(order.specification || ''),
      drawingStatus: order.drawingStatus,
      hasOriginalDrawing: hasOriginalProductionDrawing(order),
      materialStatus: order.materialStatus,
      warehouseMaterialStatus: order.materialTask?.status,
      warehouseExceptionType: order.materialTask?.exceptionType,
      warehouseExceptionNote: order.materialTask?.exceptionNote,
      warehouseExpectedAt: order.materialTask?.expectedAt,
      latestProgressRemark: order.latestProgressRemark,
      plannedAt: order.plannedAt,
    }, now)
    : [];
  for (const item of quick) {
    if (item === 'due_today' && !isDueToday(order, now)) return false;
    if (item === 'overdue' && !isOverdue(order, now)) return false;
    if (item === 'urgent' && order.priority !== 'urgent') return false;
    if (item === 'drawing' && !productionAlerts.some(alert => alert.code === 'DRAWING_NOT_ISSUED')) return false;
    if (item === 'material' && !productionAlerts.some(alert => alert.code === 'MATERIAL_NOT_READY')) return false;
    if (item === 'documents' && hasRequiredProductionDocuments(order)) return false;
    if (item === 'completed' && !flowStages.includes('completed')) return false;
    if (item === 'updated_today' && !inChinaDay(order.lastProgressAt, now)) return false;
    if (item === 'completed_today' && !inChinaDay(order.completedAt, now)) return false;
    if (item === 'delivery_missing' && (order.plannedAt || text(order.deliveryDay))) return false;
    if (item === 'specification_invalid' && text(order.specification) && !isInvalidSpecification(order.specification || '')) return false;
    if (item === 'customer_missing' && text(order.customerName)) return false;
    if (item === 'drawing_confirmation' && !productionAlerts.some(alert => isDrawingConfirmationAlert(alert.code))) return false;
    if (item === 'tail_remaining' && !productionAlerts.some(alert => alert.code === 'TAIL_REMAINING')) return false;
    if (item === 'due_soon' && !isProductionDueSoon(order, now)) return false;
    if (item === 'in_production' && normalizedStage !== 'frontend' && normalizedStage !== 'backend') return false;
    if (item === 'not_started' && normalizedStage !== 'not_issued') return false;
    if ((item === 'has_next_process' || item === 'waiting_transfer') && !hasNextProductionProcess(order)) return false;
    const activeArrangements = arrangements.filter(activeArrangement);
    if (item === 'arrangement_unassigned' && (activeArrangements.length > 0 || normalizedStage === 'completed')) return false;
    if (item === 'arrangement_scheduled' && activeArrangements.length === 0) return false;
    if (item === 'arrangement_today' && !activeArrangements.some(arrangement => arrangement.workDate === chinaYmd(now))) return false;
    if (item === 'arrangement_overdue' && !activeArrangements.some(arrangement => arrangement.overdue)) return false;
    if (item === 'arrangement_partial' && !activeArrangements.some(arrangement => arrangement.partial)) return false;
  }
  return true;
}

function drawingConfirmationRequired(order: ProductionStatusOrderRecord, now: Date): boolean {
  const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
  return getProductionAlerts({
    uncompletedQty: order.uncompletedQty,
    productionTargetQty: order.productionTargetQty,
    completedQty: order.completedQty,
    stage,
    specification: order.specification,
    drawingStatus: order.drawingStatus,
    hasOriginalDrawing: hasOriginalProductionDrawing(order),
    materialStatus: order.materialStatus,
    warehouseMaterialStatus: order.materialTask?.status,
    warehouseExceptionType: order.materialTask?.exceptionType,
    warehouseExceptionNote: order.materialTask?.exceptionNote,
    warehouseExpectedAt: order.materialTask?.expectedAt,
    latestProgressRemark: order.latestProgressRemark,
    plannedAt: order.plannedAt,
  }, now).some(alert => isDrawingConfirmationAlert(alert.code));
}

function booleanRank(value: boolean): number {
  return value ? 0 : 1;
}

export function compareProductionOrders(first: ProductionStatusOrderRecord, second: ProductionStatusOrderRecord, now = new Date()): number {
  const firstStage = normalizeWorkOrderStage(first.stage || first.status) || 'not_issued';
  const secondStage = normalizeWorkOrderStage(second.stage || second.status) || 'not_issued';
  if (firstStage === 'completed' && secondStage === 'completed') {
    return (second.completedAt?.getTime() || 0) - (first.completedAt?.getTime() || 0)
      || text(first.specification).localeCompare(text(second.specification), 'zh-CN');
  }
  if (firstStage === 'completed' || secondStage === 'completed') return firstStage === 'completed' ? 1 : -1;

  const firstRemaining = getProductionQuantitySummary({
    uncompletedQty: first.uncompletedQty, productionTargetQty: first.productionTargetQty, completedQty: first.completedQty, stage: firstStage,
  }).remainingQty;
  const secondRemaining = getProductionQuantitySummary({
    uncompletedQty: second.uncompletedQty, productionTargetQty: second.productionTargetQty, completedQty: second.completedQty, stage: secondStage,
  }).remainingQty;
  return booleanRank(first.priority === 'urgent') - booleanRank(second.priority === 'urgent')
    || booleanRank(isOverdue(first, now)) - booleanRank(isOverdue(second, now))
    || booleanRank(isDueToday(first, now)) - booleanRank(isDueToday(second, now))
    || booleanRank(drawingConfirmationRequired(first, now)) - booleanRank(drawingConfirmationRequired(second, now))
    || (first.plannedAt?.getTime() || Number.MAX_SAFE_INTEGER) - (second.plannedAt?.getTime() || Number.MAX_SAFE_INTEGER)
    || (secondRemaining ?? -1) - (firstRemaining ?? -1)
    || text(first.specification).localeCompare(text(second.specification), 'zh-CN');
}

export async function loadProductionOrders(
  week: ProductionWeek,
  workOrderId?: string,
  scope?: ProductionEntityScope,
) {
  const scopeWhere = productionWorkOrderScopeWhere(scope);
  const orders = await prisma.workOrder.findMany({
    where: workOrderId
      ? { id: workOrderId, deletedAt: null, ...scopeWhere }
      : { ...productionWeekWhere(week), ...scopeWhere },
    include: productionExecutionInclude,
    orderBy: [{ priority: 'asc' }, { plannedAt: 'asc' }, { createdAt: 'asc' }],
  });
  return !workOrderId && week.scope === 'carryover'
    ? orders.filter(order => normalizeWorkOrderStage(order.stage || order.status) !== 'completed')
    : orders;
}

export async function loadProductionSummaryOrders(
  week: ProductionWeek,
  workOrderId?: string,
  scope?: ProductionEntityScope,
) {
  const scopeWhere = productionWorkOrderScopeWhere(scope);
  const orders = await prisma.workOrder.findMany({
    where: workOrderId
      ? { id: workOrderId, deletedAt: null, ...scopeWhere }
      : { ...productionWeekWhere(week), ...scopeWhere },
    include: productionSummaryInclude,
    orderBy: [{ priority: 'asc' }, { plannedAt: 'asc' }, { createdAt: 'asc' }],
  });
  return !workOrderId && week.scope === 'carryover'
    ? orders.filter(order => normalizeWorkOrderStage(order.stage || order.status) !== 'completed')
    : orders;
}

export async function loadProductionExecution(input: {
  week: ProductionWeek;
  filters?: ProductionExecutionFilters;
  view?: ProductionExecutionView;
  page?: number;
  pageSize?: number;
  offset?: number;
  includeSummary?: boolean;
  productionScope?: ProductionEntityScope;
}) {
  const now = new Date();
  const filters = input.filters || {};
  const all = await loadProductionSummaryOrders(input.week, filters.workOrderId, input.productionScope);
  const arrangementsByOrder = await loadProductionArrangementMap(all, now, input.productionScope);
  let summaryOrders = all;
  let summaryArrangementsByOrder = arrangementsByOrder;
  // A deep link narrows the board to one work order, but the command-center
  // summary must retain its historical scope-wide meaning.
  if (input.includeSummary && filters.workOrderId) {
    summaryOrders = await loadProductionSummaryOrders(input.week, undefined, input.productionScope);
    summaryArrangementsByOrder = await loadProductionArrangementMap(summaryOrders, now, input.productionScope);
  }
  let filtered = all.filter(order => matchesFilters(order, filters, input.week, arrangementsByOrder.get(order.id) || [], now));
  if (!filters.workOrderId && input.view === 'today') filtered = filtered.filter(order => isTodayTask(order, now));
  if (!filters.workOrderId && input.view === 'exceptions') filtered = filtered.filter(order => productionExceptionCodes(order, now).length > 0);
  filtered.sort((first, second) => compareProductionOrders(first, second, now));

  const stageCounts: Record<WorkOrderStage, number> = { not_issued: 0, frontend: 0, backend: 0, completed: 0 };
  for (const order of filtered.filter(isRootProductionOrder)) {
    const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
    const resolution = resolveEffectiveFrontendTransferredQty(order);
    const segments = resolution.ok ? resolution.state.segments : [{ stage, quantity: 0 }];
    for (const segment of segments) stageCounts[segment.stage] += 1;
  }
  const pageSize = Math.min(Math.max(input.pageSize || 120, 1), 5000);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(input.page || 1, 1), totalPages);
  const offset = input.offset === undefined
    ? (page - 1) * pageSize
    : Math.min(Math.max(input.offset, 0), total);
  const pageOrderIds = filtered.slice(offset, offset + pageSize).map(order => order.id);
  const pageOrders = pageOrderIds.length
    ? await prisma.workOrder.findMany({
      where: { id: { in: pageOrderIds }, deletedAt: null },
      include: productionExecutionInclude,
    })
    : [];
  const pageOrderById = new Map(pageOrders.map(order => [order.id, order] as const));
  const carryoverByOrder = input.week.scope === 'current' && input.week.weekStart
    ? await loadProductionCarryoverMetadata(input.week.weekStart, pageOrderIds)
    : new Map<string, ProductionCarryoverMetadata>();
  const items = pageOrderIds.flatMap(id => {
    const order = pageOrderById.get(id);
    return order ? [{
      ...serializeProductionOrder(order, now, carryoverByOrder.get(order.id) || null),
      arrangements: arrangementsByOrder.get(order.id) || [],
    }] : [];
  });
  return {
    scope: input.week.scope,
    readOnly: input.week.scope === 'history' || input.productionScope?.readOnly === true,
    weekStartDate: input.week.weekStart ? chinaYmd(input.week.weekStart) : null,
    weekEndDate: input.week.weekEnd ? chinaYmd(input.week.weekEnd) : null,
    stageCounts,
    items,
    arrangementMetrics: summarizeArrangementMetrics(all, arrangementsByOrder),
    filterOptions: {
      customers: [...new Set(all.map(order => text(order.customerName)).filter(Boolean))].sort((first, second) => first.localeCompare(second, 'zh-CN')),
    },
    pagination: { page, pageSize, total, totalPages },
    ...(input.includeSummary ? {
      summary: summarizeProductionRecords(
        input.week,
        summaryOrders.filter(isRootProductionOrder),
        summaryArrangementsByOrder,
        now,
        input.productionScope,
      ),
    } : {}),
  };
}

function summarizeProductionRecords(
  week: ProductionWeek,
  orders: ProductionStatusOrderRecord[],
  arrangementsByOrder: Map<string, ProductionArrangementView[]>,
  now: Date,
  scope?: ProductionEntityScope,
) {
  const stageCounts: Record<WorkOrderStage, number> = { not_issued: 0, frontend: 0, backend: 0, completed: 0 };
  const stageQuantityTotals: Record<WorkOrderStage, number> = { not_issued: 0, frontend: 0, backend: 0, completed: 0 };
  let targetQuantity = 0;
  let completedQuantity = 0;
  let quantityKnownOrders = 0;
  let quantityMissingOrders = 0;
  let dueToday = 0;
  let overdue = 0;
  let notIssuedDrawing = 0;
  let materialNotReady = 0;
  let incompleteDocuments = 0;
  let drawingConfirmation = 0;
  let tailRemaining = 0;
  let urgent = 0;
  let completed = 0;
  let exceptions = 0;
  let dispatchInProduction = 0;
  let dispatchNotStarted = 0;
  let dispatchWithNextProcess = 0;
  let dispatchDueSoon = 0;
  let dispatchCompleted = 0;
  for (const order of orders) {
    const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
    const flowResolution = resolveEffectiveFrontendTransferredQty(order);
    const segments = flowResolution.ok ? flowResolution.state.segments : [{ stage, quantity: 0 }];
    for (const segment of segments) {
      stageCounts[segment.stage] += 1;
      stageQuantityTotals[segment.stage] += segment.quantity;
    }
    const quantity = getProductionQuantitySummary({
      uncompletedQty: order.uncompletedQty,
      productionTargetQty: order.productionTargetQty,
      completedQty: order.completedQty,
      stage,
    });
    if (quantity.targetQty !== null && quantity.targetQty > 0 && quantity.completedQty !== null) {
      targetQuantity += quantity.targetQty;
      completedQuantity += quantity.completedQty;
      quantityKnownOrders += 1;
    } else {
      quantityMissingOrders += 1;
    }
    if (isDueToday(order, now)) dueToday += 1;
    if (isOverdue(order, now)) overdue += 1;
    if (!hasRequiredProductionDocuments(order)) incompleteDocuments += 1;
    const alerts = getProductionAlerts({
      uncompletedQty: order.uncompletedQty,
      productionTargetQty: order.productionTargetQty,
      completedQty: order.completedQty,
      stage,
      specification: order.specification,
      specificationInvalid: !text(order.specification) || isInvalidSpecification(order.specification || ''),
      drawingStatus: order.drawingStatus,
      hasOriginalDrawing: hasOriginalProductionDrawing(order),
      materialStatus: order.materialStatus,
      warehouseMaterialStatus: order.materialTask?.status,
      warehouseExceptionType: order.materialTask?.exceptionType,
      warehouseExceptionNote: order.materialTask?.exceptionNote,
      warehouseExpectedAt: order.materialTask?.expectedAt,
      latestProgressRemark: order.latestProgressRemark,
      plannedAt: order.plannedAt,
    }, now);
    if (alerts.some(alert => alert.code === 'DRAWING_NOT_ISSUED')) notIssuedDrawing += 1;
    if (alerts.some(alert => isDrawingConfirmationAlert(alert.code))) drawingConfirmation += 1;
    if (alerts.some(alert => alert.code === 'MATERIAL_NOT_READY')) materialNotReady += 1;
    if (alerts.some(alert => alert.code === 'TAIL_REMAINING')) tailRemaining += 1;
    if (order.priority === 'urgent') urgent += 1;
    if (segments.some(segment => segment.stage === 'completed')) completed += 1;
    if (productionExceptionCodes(order, now).length > 0) exceptions += 1;
    if (stage === 'frontend' || stage === 'backend') dispatchInProduction += 1;
    if (stage === 'not_issued') dispatchNotStarted += 1;
    if (hasNextProductionProcess(order)) dispatchWithNextProcess += 1;
    if (isProductionDueSoon(order, now)) dispatchDueSoon += 1;
    if (stage === 'completed') dispatchCompleted += 1;
  }
  return {
    scope: week.scope,
    readOnly: week.scope === 'history' || scope?.readOnly === true,
    weekStartDate: week.weekStart ? chinaYmd(week.weekStart) : null,
    weekEndDate: week.weekEnd ? chinaYmd(week.weekEnd) : null,
    total: orders.length,
    dueToday,
    overdue,
    notIssuedDrawing,
    materialNotReady,
    incompleteDocuments,
    drawingConfirmation,
    tailRemaining,
    urgent,
    completed,
    exceptions,
    stageCounts,
    stageQuantityTotals,
    dispatchMetrics: {
      inProduction: dispatchInProduction,
      notStarted: dispatchNotStarted,
      withNextProcess: dispatchWithNextProcess,
      dueSoon: dispatchDueSoon,
      completed: dispatchCompleted,
    },
    planTotals: productionPlanAttainment(dispatchCompleted, orders.length),
    arrangementMetrics: summarizeArrangementMetrics(orders, arrangementsByOrder),
    quantityTotals: {
      targetQty: targetQuantity,
      completedQty: completedQuantity,
      percentage: targetQuantity > 0 ? Math.round((completedQuantity / targetQuantity) * 1000) / 10 : null,
      knownOrders: quantityKnownOrders,
      missingOrders: quantityMissingOrders,
    },
  };
}

export async function summarizeProduction(week: ProductionWeek, scope?: ProductionEntityScope) {
  const now = new Date();
  const orders = (await loadProductionSummaryOrders(week, undefined, scope)).filter(isRootProductionOrder);
  const arrangementsByOrder = await loadProductionArrangementMap(orders, now, scope);
  return summarizeProductionRecords(week, orders, arrangementsByOrder, now, scope);
}

export async function loadProductionOrderById(id: string, scope?: ProductionEntityScope) {
  return prisma.workOrder.findFirst({
    where: { id, deletedAt: null, ...productionWorkOrderScopeWhere(scope) },
    include: productionExecutionInclude,
  });
}

export function safeCompletedQuantity(value: unknown) {
  if (value === undefined) return { provided: false, value: undefined as string | null | undefined };
  const normalized = String(value ?? '').trim().slice(0, 80);
  if (!normalized) return { provided: true, value: null as string | null };
  const numeric = Number(normalized.replace(/,/g, ''));
  if (Number.isFinite(numeric) && numeric < 0) return { provided: true, value: normalized, error: '完成数量不能为负数' };
  return { provided: true, value: normalized as string | null };
}
