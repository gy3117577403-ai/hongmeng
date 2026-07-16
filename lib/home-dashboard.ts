import { isInvalidSpecification } from '@/lib/drawing-library';
import { getProductionAlerts, isDrawingConfirmationAlert, type ProductionAlert } from '@/lib/production-alerts';
import {
  chinaDayBounds,
  compareProductionOrders,
  executionCompleteness,
  loadProductionOrders,
  productionExceptionCodes,
  resolveProductionWeek,
  type ProductionExecutionOrderRecord,
} from '@/lib/production-execution';
import { resolveEffectiveFrontendTransferredQty } from '@/lib/production-stage-flow';
import { issueStatusLabels } from '@/lib/issues';
import { prisma } from '@/lib/prisma';
import { normalizeWorkOrderStage, stageText } from '@/lib/work-orders';
import type {
  HomeActionItem,
  HomeCollaborationNode,
  HomeDashboardData,
  HomeDistributionItem,
  HomeKpi,
  HomePriority,
  HomeTimelineItem,
  HomeTone,
} from '@/types/home-dashboard';

type ActionDefinition = {
  type: string;
  label: string;
  priority: HomePriority;
  quick: string;
  view: 'today' | 'exceptions';
};

const actionPriority: Record<HomePriority, number> = { urgent: 0, high: 1, normal: 2 };

function text(value?: string | null): string {
  return value?.trim() || '';
}

function chinaDateParts(value: Date): { year: string; month: string; day: string; weekday: string } {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).formatToParts(value);
  const get = (type: string): string => parts.find(part => part.type === type)?.value || '';
  return { year: get('year'), month: get('month'), day: get('day'), weekday: get('weekday') };
}

function chinaDateLabel(value: Date): string {
  const parts = chinaDateParts(value);
  return `${parts.year}年${parts.month}月${parts.day}日 ${parts.weekday}`;
}

function shortDate(value?: Date | null): string {
  if (!value) return '日期未设置';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
  }).format(value);
}

function ymd(value?: Date | null): string | null {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const get = (type: string): string => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function greeting(value: Date): string {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false,
  }).format(value));
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function stageOf(order: ProductionExecutionOrderRecord) {
  return normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
}

function alertsFor(order: ProductionExecutionOrderRecord, now: Date): ProductionAlert[] {
  const stage = stageOf(order);
  return getProductionAlerts({
    uncompletedQty: order.uncompletedQty,
    completedQty: order.completedQty,
    stage,
    specification: order.specification,
    specificationInvalid: !text(order.specification) || isInvalidSpecification(order.specification || ''),
    drawingStatus: order.drawingStatus,
    materialStatus: order.materialStatus,
    latestProgressRemark: order.latestProgressRemark,
    plannedAt: order.plannedAt,
  }, now);
}

function dueToday(order: ProductionExecutionOrderRecord, now: Date): boolean {
  if (stageOf(order) === 'completed' || !order.plannedAt) return false;
  const { start, end } = chinaDayBounds(now);
  return order.plannedAt >= start && order.plannedAt < end;
}

function happenedToday(value: Date | null | undefined, now: Date): boolean {
  if (!value) return false;
  const { start, end } = chinaDayBounds(now);
  return value >= start && value < end;
}

function drawingConfirmation(alerts: ProductionAlert[]): boolean {
  return alerts.some(alert => isDrawingConfirmationAlert(alert.code));
}

function hasAlert(alerts: ProductionAlert[], code: ProductionAlert['code']): boolean {
  return alerts.some(alert => alert.code === code);
}

function orderRoute(order: ProductionExecutionOrderRecord, definition: ActionDefinition): string {
  const params = new URLSearchParams({ view: definition.view, quick: definition.quick });
  const keyword = text(order.specification) || text(order.code);
  if (keyword) params.set('keyword', keyword);
  return `/production?${params.toString()}`;
}

function actionItem(order: ProductionExecutionOrderRecord, definition: ActionDefinition): HomeActionItem {
  const customer = text(order.customerName) || '客户未设置';
  const specification = text(order.specification) || text(order.code) || '规格未设置';
  const stage = stageOf(order);
  const occurredAt = (order.plannedAt || order.lastProgressAt || order.updatedAt).toISOString();
  return {
    id: `${order.id}:${definition.type}`,
    workOrderId: order.id,
    sourceModule: '生产执行',
    type: definition.type,
    title: definition.label,
    subtitle: `${customer} · ${specification}`,
    customerName: customer,
    specification,
    priority: definition.priority,
    status: stageText[stage],
    occurredAt,
    dateLabel: order.plannedAt ? `计划 ${shortDate(order.plannedAt)}` : `更新 ${shortDate(order.updatedAt)}`,
    targetRoute: orderRoute(order, definition),
  };
}

function actionsFor(order: ProductionExecutionOrderRecord, now: Date): HomeActionItem[] {
  const alerts = alertsFor(order, now);
  const exceptions = new Set(productionExceptionCodes(order, now));
  const definitions: ActionDefinition[] = [];
  if (exceptions.has('overdue')) definitions.push({ type: 'overdue', label: '工单已逾期', priority: 'urgent', quick: 'overdue', view: 'exceptions' });
  if (dueToday(order, now)) definitions.push({ type: 'due_today', label: '今日交期', priority: order.priority === 'urgent' ? 'urgent' : 'high', quick: 'due_today', view: 'today' });
  if (drawingConfirmation(alerts)) definitions.push({ type: 'drawing_confirmation', label: '图纸待确认', priority: 'high', quick: 'drawing_confirmation', view: 'exceptions' });
  if (hasAlert(alerts, 'MATERIAL_NOT_READY')) definitions.push({ type: 'material_not_ready', label: '配料异常', priority: 'high', quick: 'material', view: 'exceptions' });
  if (hasAlert(alerts, 'TAIL_REMAINING')) definitions.push({ type: 'tail_remaining', label: '尾数未清', priority: 'normal', quick: 'tail_remaining', view: 'exceptions' });
  if (exceptions.has('documents_incomplete')) definitions.push({ type: 'documents_incomplete', label: '资料不完整', priority: 'normal', quick: 'documents', view: 'exceptions' });
  return definitions.map(definition => actionItem(order, definition));
}

function actionSort(first: HomeActionItem, second: HomeActionItem): number {
  return actionPriority[first.priority] - actionPriority[second.priority]
    || new Date(first.occurredAt).getTime() - new Date(second.occurredAt).getTime()
    || first.subtitle.localeCompare(second.subtitle, 'zh-CN');
}

function persistedIssueAction(issue: {
  id: string;
  type: string;
  title: string;
  priority: string;
  status: string;
  description: string | null;
  dueAt: Date | null;
  updatedAt: Date;
  workOrder: { id: string; customerName: string | null; specification: string | null; code: string } | null;
}): HomeActionItem {
  const customer = text(issue.workOrder?.customerName) || '未关联客户';
  const specification = text(issue.workOrder?.specification) || text(issue.workOrder?.code) || '未关联工单';
  const priority: HomePriority = issue.priority === 'urgent' ? 'urgent' : issue.priority === 'high' ? 'high' : 'normal';
  return {
    id: issue.id,
    workOrderId: issue.workOrder?.id || '',
    sourceModule: '问题管理',
    type: issue.type,
    title: issue.title,
    subtitle: issue.workOrder ? `${customer} · ${specification}` : (text(issue.description).slice(0, 80) || '独立问题'),
    customerName: customer,
    specification,
    priority,
    status: issueStatusLabels[issue.status as keyof typeof issueStatusLabels] || issue.status,
    occurredAt: issue.updatedAt.toISOString(),
    dateLabel: issue.dueAt ? `截止 ${shortDate(issue.dueAt)}` : `更新 ${shortDate(issue.updatedAt)}`,
    targetRoute: `/workspace/issues?issueId=${encodeURIComponent(issue.id)}`,
  };
}

function distribution(id: string, label: string, value: number, tone: HomeTone): HomeDistributionItem {
  return { id, label, value, tone };
}

function collaboration(id: string, label: string, value: number, description: string, route: string, tone: HomeTone): HomeCollaborationNode {
  return { id, label, value, description, route, tone };
}

function emptyKpis(): HomeKpi[] {
  return [
    { id: 'weekly', label: '本周计划工单', value: null, description: '暂不可用', route: '/weekly-plan-center', tone: 'orange', icon: '周' },
    { id: 'due', label: '今日交期', value: null, description: '暂不可用', route: '/production', tone: 'blue', icon: '今' },
    { id: 'overdue', label: '逾期工单', value: null, description: '暂不可用', route: '/production', tone: 'red', icon: '逾' },
    { id: 'drawing', label: '图纸待确认', value: null, description: '暂不可用', route: '/production', tone: 'yellow', icon: '图' },
    { id: 'material', label: '配料异常', value: null, description: '暂不可用', route: '/production', tone: 'yellow', icon: '料' },
    { id: 'tail', label: '尾数未清', value: null, description: '暂不可用', route: '/production', tone: 'slate', icon: '尾' },
  ];
}

export function emptyHomeDashboardData(message: string, now = new Date()): HomeDashboardData {
  return {
    generatedAt: now.toISOString(),
    dateLabel: chinaDateLabel(now),
    greeting: greeting(now),
    periodLabel: '计划、技术、生产协同工作台',
    weekStartDate: null,
    weekEndDate: null,
    error: message,
    kpis: emptyKpis(),
    actionItems: [],
    todayNodes: [],
    issues: [],
    planChart: { total: 0, completed: 0, inProgress: 0, notStarted: 0, overdue: 0, executionRate: null },
    stageDistribution: [],
    technicalDistribution: [],
    collaboration: [],
  };
}

export async function loadHomeDashboard(now = new Date()): Promise<HomeDashboardData> {
  const week = await resolveProductionWeek();
  const [orders, persistedIssues] = await Promise.all([
    loadProductionOrders(week),
    prisma.issue.findMany({
      where: { deletedAt: null, status: { not: 'closed' } },
      include: { workOrder: { select: { id: true, customerName: true, specification: true, code: true } } },
      orderBy: [{ priority: 'asc' }, { updatedAt: 'desc' }],
      take: 20,
    }),
  ]);
  orders.sort((first, second) => compareProductionOrders(first, second, now));

  const stageCounts = { not_issued: 0, frontend: 0, backend: 0, completed: 0 };
  let dueTodayCount = 0;
  let overdueCount = 0;
  let drawingConfirmationCount = 0;
  let materialIssueCount = 0;
  let tailRemainingCount = 0;
  let completeDocuments = 0;
  let drawingAttention = 0;
  let missingDocuments = 0;
  let completedOrders = 0;
  let inProgressOrders = 0;
  let notStartedOrders = 0;
  const allActions: HomeActionItem[] = [];
  const todayNodes: HomeTimelineItem[] = [];

  for (const order of orders) {
    const stage = stageOf(order);
    const alerts = alertsFor(order, now);
    const exceptions = new Set(productionExceptionCodes(order, now));
    const completeness = executionCompleteness(order);
    const flow = resolveEffectiveFrontendTransferredQty(order);
    const segments = flow.ok ? flow.state.segments : [{ stage, quantity: 0 }];
    for (const segment of segments) stageCounts[segment.stage] += 1;

    if (stage === 'completed') completedOrders += 1;
    else if (stage === 'not_issued') notStartedOrders += 1;
    else inProgressOrders += 1;
    if (dueToday(order, now)) dueTodayCount += 1;
    if (exceptions.has('overdue')) overdueCount += 1;
    if (drawingConfirmation(alerts)) drawingConfirmationCount += 1;
    if (hasAlert(alerts, 'MATERIAL_NOT_READY')) materialIssueCount += 1;
    if (hasAlert(alerts, 'TAIL_REMAINING')) tailRemainingCount += 1;

    if (drawingConfirmation(alerts)) drawingAttention += 1;
    else if (completeness.complete) completeDocuments += 1;
    else missingDocuments += 1;

    allActions.push(...actionsFor(order, now));
    const customer = text(order.customerName) || '客户未设置';
    const specification = text(order.specification) || text(order.code) || '规格未设置';
    if (dueToday(order, now)) {
      todayNodes.push({
        id: `${order.id}:delivery`, type: '今日交期', title: `${customer} · ${specification}`,
        source: '周计划', status: stageText[stage], dateLabel: '今日',
        targetRoute: orderRoute(order, { type: 'due_today', label: '今日交期', priority: 'high', quick: 'due_today', view: 'today' }),
      });
    } else if (drawingConfirmation(alerts) && happenedToday(order.updatedAt, now)) {
      todayNodes.push({
        id: `${order.id}:drawing`, type: '图纸确认', title: `${customer} · ${specification}`,
        source: '技术资料', status: stageText[stage], dateLabel: '今日更新',
        targetRoute: orderRoute(order, { type: 'drawing_confirmation', label: '图纸待确认', priority: 'high', quick: 'drawing_confirmation', view: 'exceptions' }),
      });
    }
  }

  allActions.sort(actionSort);
  const persistedIssueActions = persistedIssues.map(persistedIssueAction).sort(actionSort);
  todayNodes.sort((first, second) => first.title.localeCompare(second.title, 'zh-CN'));
  const total = orders.length;
  const executionRate = total > 0 ? Math.round((completedOrders / total) * 100) : null;
  const periodLabel = week.weekStart
    ? `${shortDate(week.weekStart)} - ${shortDate(week.weekEnd || week.weekStart)} 周计划`
    : '当前未启用周计划';

  const kpis: HomeKpi[] = [
    { id: 'weekly', label: '本周计划工单', value: total, description: week.weekStart ? '当前启用周计划' : '当前未启用周计划', route: '/weekly-plan-center', tone: 'orange', icon: '周' },
    { id: 'due', label: '今日交期', value: dueTodayCount, description: '今日需交付工单', route: '/production?view=today&quick=due_today', tone: 'blue', icon: '今' },
    { id: 'overdue', label: '逾期工单', value: overdueCount, description: '未完成且已过计划日', route: '/production?view=exceptions&quick=overdue', tone: 'red', icon: '逾' },
    { id: 'drawing', label: '图纸待确认', value: drawingConfirmationCount, description: '样品、客户确认或变更', route: '/production?view=exceptions&quick=drawing_confirmation', tone: 'yellow', icon: '图' },
    { id: 'material', label: '配料异常', value: materialIssueCount, description: '按现有配料告警口径', route: '/production?view=exceptions&quick=material', tone: 'yellow', icon: '料' },
    { id: 'tail', label: '尾数未清', value: tailRemainingCount, description: '按现有数量告警口径', route: '/production?view=exceptions&quick=tail_remaining', tone: 'slate', icon: '尾' },
  ];

  return {
    generatedAt: now.toISOString(),
    dateLabel: chinaDateLabel(now),
    greeting: greeting(now),
    periodLabel,
    weekStartDate: ymd(week.weekStart),
    weekEndDate: ymd(week.weekEnd),
    error: null,
    kpis,
    actionItems: allActions.slice(0, 8),
    todayNodes: todayNodes.slice(0, 6),
    issues: persistedIssueActions.slice(0, 5),
    planChart: { total, completed: completedOrders, inProgress: inProgressOrders, notStarted: notStartedOrders, overdue: overdueCount, executionRate },
    stageDistribution: [
      distribution('not-issued', '未发图', stageCounts.not_issued, 'yellow'),
      distribution('frontend', '在前端', stageCounts.frontend, 'blue'),
      distribution('backend', '在后端', stageCounts.backend, 'orange'),
      distribution('completed', '已完成', stageCounts.completed, 'green'),
    ],
    technicalDistribution: [
      distribution('complete', '资料完整', completeDocuments, 'green'),
      distribution('drawing', '图纸待确认', drawingAttention, 'yellow'),
      distribution('missing', '缺少资料', missingDocuments, 'red'),
    ],
    collaboration: [
      collaboration('plan', '计划下达', total, week.weekStart ? '当前启用周计划' : '等待启用周计划', '/weekly-plan-center', 'orange'),
      collaboration('technical', '技术资料确认', completeDocuments, '必需资料分类完整', '/drawing-library', 'blue'),
      collaboration('production', '生产执行', inProgressOrders, '前端与后端执行中', '/production', 'yellow'),
      collaboration('completed', '完成闭环', completedOrders, '总体阶段已完成', '/production?quick=completed', 'green'),
    ],
  };
}
