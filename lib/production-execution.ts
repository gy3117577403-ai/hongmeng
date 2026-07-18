import { Prisma } from '@prisma/client';
import { isInvalidSpecification } from '@/lib/drawing-library';
import { prisma } from '@/lib/prisma';
import { getProductionAlerts, isDrawingConfirmationAlert } from '@/lib/production-alerts';
import { getProductionQuantitySummary, parsedImportedProductionTarget } from '@/lib/production-quantity';
import { processRouteSummaryInclude, serializeProcessRoute } from '@/lib/process-routing';
import { resolveEffectiveFrontendTransferredQty } from '@/lib/production-stage-flow';
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
});

export type ProductionExecutionOrderRecord = Prisma.WorkOrderGetPayload<{
  include: typeof productionExecutionInclude;
}>;

export type ProductionExceptionCode =
  | 'overdue'
  | 'drawing_not_issued'
  | 'material_not_ready'
  | 'documents_incomplete'
  | 'delivery_missing'
  | 'specification_invalid'
  | 'customer_missing';

export type ProductionExecutionView = 'board' | 'today' | 'exceptions';

export type ProductionExecutionFilters = {
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
  weekStart: Date | null;
  weekEnd: Date | null;
};

const exceptionLabels: Record<ProductionExceptionCode, string> = {
  overdue: '已逾期',
  drawing_not_issued: '未发图',
  material_not_ready: '仓库异常',
  documents_incomplete: '资料不完整',
  delivery_missing: '交期缺失',
  specification_invalid: '规格异常',
  customer_missing: '客户缺失',
};

const validQuickFilters = new Set([
  'overdue', 'urgent', 'drawing', 'material', 'documents', 'completed',
  'due_today', 'updated_today', 'completed_today', 'delivery_missing',
  'specification_invalid', 'customer_missing', 'drawing_confirmation', 'tail_remaining',
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
      planType: { in: ['weekly_plan', 'managed_plan'] },
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
    planType: { in: ['weekly_plan', 'managed_plan'] },
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
  const alerts = getProductionAlerts({
    uncompletedQty: order.uncompletedQty,
    productionTargetQty: order.productionTargetQty,
    completedQty: order.completedQty,
    stage,
    specification: order.specification,
    specificationInvalid: !text(order.specification) || isInvalidSpecification(order.specification || ''),
    drawingStatus: order.drawingStatus,
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
  if (!executionCompleteness(order).complete) exceptions.push('documents_incomplete');
  if (!order.plannedAt && !text(order.deliveryDay)) exceptions.push('delivery_missing');
  if (!text(order.specification) || isInvalidSpecification(order.specification || '')) exceptions.push('specification_invalid');
  if (!text(order.customerName)) exceptions.push('customer_missing');
  return exceptions;
}

export function serializeProductionOrder(order: ProductionExecutionOrderRecord, now = new Date()) {
  const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
  const completeness = executionCompleteness(order);
  const exceptionCodes = productionExceptionCodes(order, now);
  const quantitySummary = getProductionQuantitySummary({
    uncompletedQty: order.uncompletedQty,
    productionTargetQty: order.productionTargetQty,
    completedQty: order.completedQty,
    stage,
  });
  const productionAlerts = getProductionAlerts({
    uncompletedQty: order.uncompletedQty,
    productionTargetQty: order.productionTargetQty,
    completedQty: order.completedQty,
    stage,
    specification: order.specification,
    specificationInvalid: !text(order.specification) || isInvalidSpecification(order.specification || ''),
    drawingStatus: order.drawingStatus,
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

function drawingStatusValue(order: ProductionExecutionOrderRecord) {
  const value = text(order.drawingStatus);
  if (!value || value === '-' || value.includes('未设置')) return 'unset';
  if (value.includes('样品') && value.includes('确认')) return 'sample_confirmation';
  if (value.includes('客户') && value.includes('确认')) return 'customer_confirmation';
  if (value.includes('变更')) return 'change_required';
  if (value.includes('已确认')) return 'confirmed';
  if (value.includes('未发') || value.includes('未下发')) return 'not_issued';
  if (value.includes('已发') || value.includes('已下发')) return 'issued';
  return 'issued';
}

function materialStatusValue(order: ProductionExecutionOrderRecord) {
  if (!order.materialTask) return 'unset';
  if (order.materialTask.status === 'pending') return 'pending';
  if (order.materialTask.status === 'completed') return 'completed';
  if (order.materialTask.status === 'exception') return 'exception';
  return 'unset';
}

function matchesDuePreset(order: ProductionExecutionOrderRecord, preset: string | undefined, week: ProductionWeek, now: Date) {
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

function matchesFilters(order: ProductionExecutionOrderRecord, filters: ProductionExecutionFilters, week: ProductionWeek, now = new Date()) {
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
    if (item === 'documents' && completeness.complete) return false;
    if (item === 'completed' && !flowStages.includes('completed')) return false;
    if (item === 'updated_today' && !inChinaDay(order.lastProgressAt, now)) return false;
    if (item === 'completed_today' && !inChinaDay(order.completedAt, now)) return false;
    if (item === 'delivery_missing' && (order.plannedAt || text(order.deliveryDay))) return false;
    if (item === 'specification_invalid' && text(order.specification) && !isInvalidSpecification(order.specification || '')) return false;
    if (item === 'customer_missing' && text(order.customerName)) return false;
    if (item === 'drawing_confirmation' && !productionAlerts.some(alert => isDrawingConfirmationAlert(alert.code))) return false;
    if (item === 'tail_remaining' && !productionAlerts.some(alert => alert.code === 'TAIL_REMAINING')) return false;
  }
  return true;
}

function drawingConfirmationRequired(order: ProductionExecutionOrderRecord, now: Date): boolean {
  const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
  return getProductionAlerts({
    uncompletedQty: order.uncompletedQty,
    productionTargetQty: order.productionTargetQty,
    completedQty: order.completedQty,
    stage,
    specification: order.specification,
    drawingStatus: order.drawingStatus,
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

export function compareProductionOrders(first: ProductionExecutionOrderRecord, second: ProductionExecutionOrderRecord, now = new Date()): number {
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
  view?: ProductionExecutionView;
  page?: number;
  pageSize?: number;
}) {
  const now = new Date();
  const all = await loadProductionOrders(input.week);
  const filters = input.filters || {};
  let filtered = all.filter(order => matchesFilters(order, filters, input.week, now));
  if (input.view === 'today') filtered = filtered.filter(order => isTodayTask(order, now));
  if (input.view === 'exceptions') filtered = filtered.filter(order => productionExceptionCodes(order, now).length > 0);
  filtered.sort((first, second) => compareProductionOrders(first, second, now));

  const stageCounts: Record<WorkOrderStage, number> = { not_issued: 0, frontend: 0, backend: 0, completed: 0 };
  for (const order of filtered) {
    const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
    const resolution = resolveEffectiveFrontendTransferredQty(order);
    const segments = resolution.ok ? resolution.state.segments : [{ stage, quantity: 0 }];
    for (const segment of segments) stageCounts[segment.stage] += 1;
  }
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
    filterOptions: {
      customers: [...new Set(all.map(order => text(order.customerName)).filter(Boolean))].sort((first, second) => first.localeCompare(second, 'zh-CN')),
    },
    pagination: { page, pageSize, total, totalPages },
  };
}

export async function summarizeProduction(week: ProductionWeek) {
  const now = new Date();
  const orders = await loadProductionOrders(week);
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
    if (!executionCompleteness(order).complete) incompleteDocuments += 1;
    const alerts = getProductionAlerts({
      uncompletedQty: order.uncompletedQty,
      productionTargetQty: order.productionTargetQty,
      completedQty: order.completedQty,
      stage,
      specification: order.specification,
      specificationInvalid: !text(order.specification) || isInvalidSpecification(order.specification || ''),
      drawingStatus: order.drawingStatus,
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
    drawingConfirmation,
    tailRemaining,
    urgent,
    completed,
    stageCounts,
    stageQuantityTotals,
    quantityTotals: {
      targetQty: targetQuantity,
      completedQty: completedQuantity,
      percentage: targetQuantity > 0 ? Math.round((completedQuantity / targetQuantity) * 1000) / 10 : null,
      knownOrders: quantityKnownOrders,
      missingOrders: quantityMissingOrders,
    },
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
