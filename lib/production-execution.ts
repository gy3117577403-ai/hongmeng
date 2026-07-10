import { Prisma } from '@prisma/client';
import { isInvalidSpecification } from '@/lib/drawing-library';
import { prisma } from '@/lib/prisma';
import { addDays, parseWeek } from '@/lib/weekly-work-orders';
import { normalizeWorkOrderStage, stageText, type WorkOrderStage } from '@/lib/work-orders';

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
});

export type ProductionExecutionOrderRecord = Prisma.WorkOrderGetPayload<{
  include: typeof productionExecutionInclude;
}>;

export type ProductionExceptionCode =
  | 'overdue'
  | 'drawing_not_issued'
  | 'material_not_ready'
  | 'documents_incomplete'
  | 'owner_missing'
  | 'delivery_missing'
  | 'specification_invalid'
  | 'customer_missing';

export type ProductionExecutionFilters = {
  keyword?: string;
  quick?: string[];
  customer?: string;
  specification?: string;
  productName?: string;
  productionOwner?: string;
  workstation?: string;
  stage?: string;
  priority?: string;
  deliveryFrom?: string;
  deliveryTo?: string;
  completeness?: string;
  currentUserName?: string;
};

export type ProductionWeek = {
  weekStart: Date | null;
  weekEnd: Date | null;
};

const exceptionLabels: Record<ProductionExceptionCode, string> = {
  overdue: '已逾期',
  drawing_not_issued: '未发图',
  material_not_ready: '配料未齐',
  documents_incomplete: '资料不完整',
  owner_missing: '无负责人',
  delivery_missing: '交期缺失',
  specification_invalid: '规格异常',
  customer_missing: '客户缺失',
};

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

export async function resolveProductionWeek(weekStartInput?: string | null, weekEndInput?: string | null): Promise<ProductionWeek> {
  const requestedStart = parseWeek(weekStartInput);
  if (weekStartInput && !requestedStart) throw new Error('周开始日期格式不正确');
  if (requestedStart) {
    const requestedEnd = parseWeek(weekEndInput) || addDays(requestedStart, 6);
    return { weekStart: requestedStart, weekEnd: requestedEnd };
  }

  const active = await prisma.workOrder.findFirst({
    where: {
      deletedAt: null,
      planType: 'weekly_plan',
      planActive: true,
      weekStartDate: { not: null },
    },
    select: { weekStartDate: true, weekEndDate: true },
    orderBy: [{ weekStartDate: 'desc' }, { updatedAt: 'desc' }],
  });
  return {
    weekStart: active?.weekStartDate || null,
    weekEnd: active?.weekEndDate || (active?.weekStartDate ? addDays(active.weekStartDate, 6) : null),
  };
}

export function productionWeekWhere(week: ProductionWeek): Prisma.WorkOrderWhereInput {
  if (!week.weekStart) return { id: '__no_active_week__' };
  return {
    deletedAt: null,
    planType: 'weekly_plan',
    planActive: true,
    weekStartDate: sameDayRange(week.weekStart),
  };
}

export function isMaterialReady(value?: string | null) {
  const normalized = text(value);
  return normalized.includes('已配料') || normalized.includes('料齐');
}

export function executionCompleteness(order: ProductionExecutionOrderRecord) {
  const codes = new Set(order.drawingLibraryItem?.files.map(file => file.category.code) || []);
  const filled = PRODUCTION_CATEGORY_CODES.filter(code => codes.has(code)).length;
  return {
    filled,
    total: PRODUCTION_CATEGORY_CODES.length,
    text: `${filled}/${PRODUCTION_CATEGORY_CODES.length}`,
    complete: filled === PRODUCTION_CATEGORY_CODES.length,
  };
}

export function productionExceptionCodes(order: ProductionExecutionOrderRecord, now = new Date()): ProductionExceptionCode[] {
  const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
  const { start } = chinaDayBounds(now);
  const exceptions: ProductionExceptionCode[] = [];
  if (stage !== 'completed' && order.plannedAt && order.plannedAt < start) exceptions.push('overdue');
  if (!text(order.drawingStatus) || stage === 'not_issued') exceptions.push('drawing_not_issued');
  if (stage !== 'completed' && !isMaterialReady(order.materialStatus)) exceptions.push('material_not_ready');
  if (!executionCompleteness(order).complete) exceptions.push('documents_incomplete');
  if (!text(order.productionOwner)) exceptions.push('owner_missing');
  if (!order.plannedAt && !text(order.deliveryDay)) exceptions.push('delivery_missing');
  if (!text(order.specification) || isInvalidSpecification(order.specification || '')) exceptions.push('specification_invalid');
  if (!text(order.customerName)) exceptions.push('customer_missing');
  return exceptions;
}

export function serializeProductionOrder(order: ProductionExecutionOrderRecord, now = new Date()) {
  const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
  const completeness = executionCompleteness(order);
  const exceptionCodes = productionExceptionCodes(order, now);
  return {
    id: order.id,
    code: order.code,
    specification: order.specification,
    customerName: order.customerName,
    productName: order.productName,
    stage,
    stageText: stageText[stage],
    priority: order.priority,
    plannedAt: order.plannedAt?.toISOString() || null,
    deliveryDay: order.deliveryDay,
    uncompletedQty: order.uncompletedQty,
    productionOwner: order.productionOwner,
    workstation: order.workstation,
    completedQty: order.completedQty,
    startedAt: order.startedAt?.toISOString() || null,
    completedAt: order.completedAt?.toISOString() || null,
    lastProgressAt: order.lastProgressAt?.toISOString() || null,
    latestProgressRemark: order.latestProgressRemark,
    lastProgressBy: order.progressLogs[0]?.createdBy || null,
    drawingStatus: order.drawingStatus,
    materialStatus: order.materialStatus,
    drawingLibraryItemId: order.drawingLibraryItemId,
    documentCategoryCodes: [...new Set(order.drawingLibraryItem?.files.map(file => file.category.code) || [])],
    documentCompleteness: completeness.text,
    documentFilledCount: completeness.filled,
    documentTotalCount: completeness.total,
    documentsComplete: completeness.complete,
    exceptionCodes,
    exceptionLabels: exceptionCodes.map(code => exceptionLabels[code]),
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
    unitWorkHours: order.unitWorkHours,
    totalWorkHours: order.totalWorkHours,
    remark: order.remark,
    weekStartDate: order.weekStartDate?.toISOString() || null,
    weekEndDate: order.weekEndDate?.toISOString() || null,
    updatedAt: order.updatedAt.toISOString(),
  };
}

function inChinaDay(value: Date | null | undefined, now = new Date()) {
  if (!value) return false;
  const { start, end } = chinaDayBounds(now);
  return value >= start && value < end;
}

function isDueToday(order: ProductionExecutionOrderRecord, now = new Date()) {
  const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
  return stage !== 'completed' && inChinaDay(order.plannedAt, now);
}

function isOverdue(order: ProductionExecutionOrderRecord, now = new Date()) {
  const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
  return stage !== 'completed' && !!order.plannedAt && order.plannedAt < chinaDayBounds(now).start;
}

function isTodayTask(order: ProductionExecutionOrderRecord, now = new Date()) {
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

function matchesFilters(order: ProductionExecutionOrderRecord, filters: ProductionExecutionFilters, now = new Date()) {
  const keyword = lower(filters.keyword);
  if (keyword) {
    const haystack = [order.specification, order.customerName, order.productName, order.code, order.sourceOrderNo, order.productionOwner, order.workstation, order.latestProgressRemark]
      .map(lower)
      .join('\n');
    if (!haystack.includes(keyword)) return false;
  }
  const contains = (value: string | null | undefined, expected?: string) => !text(expected) || lower(value).includes(lower(expected));
  if (!contains(order.customerName, filters.customer)) return false;
  if (!contains(order.specification, filters.specification)) return false;
  if (!contains(order.productName, filters.productName)) return false;
  if (!contains(order.productionOwner, filters.productionOwner)) return false;
  if (!contains(order.workstation, filters.workstation)) return false;
  const normalizedStage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
  if (filters.stage && normalizedStage !== normalizeWorkOrderStage(filters.stage)) return false;
  if (filters.priority && order.priority !== filters.priority) return false;
  const from = dateInput(filters.deliveryFrom);
  const to = dateInput(filters.deliveryTo);
  if (from && (!order.plannedAt || order.plannedAt < from)) return false;
  if (to && (!order.plannedAt || order.plannedAt >= addDays(to, 1))) return false;
  const completeness = executionCompleteness(order);
  if (filters.completeness === 'complete' && !completeness.complete) return false;
  if (filters.completeness === 'incomplete' && completeness.complete) return false;

  const quick = (filters.quick || []).filter(item => item && item !== 'all');
  for (const item of quick) {
    if (item === 'today' && !isTodayTask(order, now)) return false;
    if (item === 'overdue' && !isOverdue(order, now)) return false;
    if (item === 'urgent' && order.priority !== 'urgent') return false;
    if (item === 'drawing' && text(order.drawingStatus) && normalizedStage !== 'not_issued') return false;
    if (item === 'material' && (normalizedStage === 'completed' || isMaterialReady(order.materialStatus))) return false;
    if (item === 'documents' && completeness.complete) return false;
    if (item === 'mine' && lower(order.productionOwner) !== lower(filters.currentUserName)) return false;
    if (item === 'completed' && normalizedStage !== 'completed') return false;
  }
  return true;
}

function taskRank(order: ProductionExecutionOrderRecord, now = new Date()) {
  if (order.priority === 'urgent') return 0;
  if (isOverdue(order, now)) return 1;
  if (isDueToday(order, now)) return 2;
  return 3;
}

export async function loadProductionOrders(week: ProductionWeek) {
  return prisma.workOrder.findMany({
    where: productionWeekWhere(week),
    include: productionExecutionInclude,
    orderBy: [{ priority: 'asc' }, { plannedAt: 'asc' }, { createdAt: 'asc' }],
  });
}

export async function loadProductionExecution(input: {
  week: ProductionWeek;
  filters?: ProductionExecutionFilters;
  view?: 'board' | 'today' | 'exceptions';
  page?: number;
  pageSize?: number;
}) {
  const now = new Date();
  const all = await loadProductionOrders(input.week);
  const filters = input.filters || {};
  let filtered = all.filter(order => matchesFilters(order, filters, now));
  if (input.view === 'today') filtered = filtered.filter(order => isTodayTask(order, now));
  if (input.view === 'exceptions') filtered = filtered.filter(order => productionExceptionCodes(order, now).length > 0);
  filtered.sort((a, b) => taskRank(a, now) - taskRank(b, now) || (a.plannedAt?.getTime() || Number.MAX_SAFE_INTEGER) - (b.plannedAt?.getTime() || Number.MAX_SAFE_INTEGER));

  const stageCounts: Record<WorkOrderStage, number> = { not_issued: 0, frontend: 0, backend: 0, completed: 0 };
  for (const order of filtered) stageCounts[normalizeWorkOrderStage(order.stage || order.status) || 'not_issued'] += 1;
  const pageSize = Math.min(Math.max(input.pageSize || 120, 1), 5000);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(input.page || 1, 1), totalPages);
  const items = filtered.slice((page - 1) * pageSize, page * pageSize).map(order => serializeProductionOrder(order, now));
  return {
    weekStartDate: input.week.weekStart ? chinaYmd(input.week.weekStart) : null,
    weekEndDate: input.week.weekEnd ? chinaYmd(input.week.weekEnd) : null,
    stageCounts,
    items,
    pagination: { page, pageSize, total, totalPages },
  };
}

export async function summarizeProduction(week: ProductionWeek) {
  const now = new Date();
  const orders = await loadProductionOrders(week);
  const stageCounts: Record<WorkOrderStage, number> = { not_issued: 0, frontend: 0, backend: 0, completed: 0 };
  let dueToday = 0;
  let overdue = 0;
  let notIssuedDrawing = 0;
  let materialNotReady = 0;
  let incompleteDocuments = 0;
  let urgent = 0;
  let completed = 0;
  for (const order of orders) {
    const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
    stageCounts[stage] += 1;
    if (isDueToday(order, now)) dueToday += 1;
    if (isOverdue(order, now)) overdue += 1;
    if (!text(order.drawingStatus) || stage === 'not_issued') notIssuedDrawing += 1;
    if (stage !== 'completed' && !isMaterialReady(order.materialStatus)) materialNotReady += 1;
    if (!executionCompleteness(order).complete) incompleteDocuments += 1;
    if (order.priority === 'urgent') urgent += 1;
    if (stage === 'completed') completed += 1;
  }
  return {
    weekStartDate: week.weekStart ? chinaYmd(week.weekStart) : null,
    weekEndDate: week.weekEnd ? chinaYmd(week.weekEnd) : null,
    total: orders.length,
    dueToday,
    overdue,
    notIssuedDrawing,
    materialNotReady,
    incompleteDocuments,
    urgent,
    completed,
    stageCounts,
  };
}

export async function loadProductionOrderById(id: string) {
  return prisma.workOrder.findFirst({
    where: { id, deletedAt: null },
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
