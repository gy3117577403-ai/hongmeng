export type WeeklyPlanDiffType = 'new' | 'continued' | 'changed' | 'removed' | 'duplicate' | 'invalid';
export type WeeklyPlanBaseDiffType = 'new' | 'continued' | 'changed' | 'removed';
export type WeeklyPlanIssueLevel = 'blocking' | 'warning';
export type WeeklyPlanIssueScope = 'current' | 'next' | 'comparison';

export type WeeklyPlanDiffSourceOrder = {
  id: string;
  code: string;
  customerName: string | null;
  productName: string;
  specification: string | null;
  processName: string | null;
  sourceOrderNo: string | null;
  uncompletedQty: string | null;
  unitWorkHours: string | null;
  totalWorkHours: string | null;
  drawingStatus: string | null;
  deliveryDay: string | null;
  plannedAt: Date | null;
  materialStatus: string | null;
  salesperson: string | null;
  remark: string | null;
  weekStartDate: Date | null;
  weekEndDate: Date | null;
  drawingLibraryItemId: string | null;
  drawingLibraryItem: {
    id: string;
    deletedAt: Date | null;
    files: Array<{ categoryId: string }>;
  } | null;
};

export type WeeklyPlanOrderView = {
  id: string;
  code: string;
  customerName: string | null;
  productName: string;
  specification: string | null;
  processName: string | null;
  sourceOrderNo: string | null;
  uncompletedQty: string | null;
  unitWorkHours: string | null;
  totalWorkHours: string | null;
  drawingStatus: string | null;
  deliveryDay: string | null;
  plannedAt: string | null;
  materialStatus: string | null;
  salesperson: string | null;
  remark: string | null;
  weekStartDate: string | null;
  weekEndDate: string | null;
  drawingLibraryItemId: string | null;
  drawingLibraryLinked: boolean;
  drawingLibraryCompleteness: string;
  drawingLibraryFileCount: number;
};

export type WeeklyPlanFieldChange = {
  field: string;
  label: string;
  before: string;
  after: string;
};

export type WeeklyPlanIssue = {
  code: string;
  label: string;
  message: string;
  level: WeeklyPlanIssueLevel;
  scope: WeeklyPlanIssueScope;
  field?: string;
};

export type WeeklyPlanDiffItem = {
  id: string;
  compareKey: string;
  type: WeeklyPlanDiffType;
  baseType: WeeklyPlanBaseDiffType;
  categories: WeeklyPlanDiffType[];
  current: WeeklyPlanOrderView | null;
  next: WeeklyPlanOrderView | null;
  currentOrderIds: string[];
  nextOrderIds: string[];
  changes: WeeklyPlanFieldChange[];
  blockers: WeeklyPlanIssue[];
  warnings: WeeklyPlanIssue[];
};

export type WeeklyPlanDiffSummary = {
  currentCount: number;
  nextCount: number;
  newCount: number;
  continuedCount: number;
  changedCount: number;
  removedCount: number;
  duplicateCount: number;
  invalidCount: number;
  blockingAnomalyCount: number;
  blockingIssueCount: number;
  warningCount: number;
  warningIssueCount: number;
  drawingLinkedCount: number;
  drawingUnlinkedCount: number;
  drawingWithFilesCount: number;
  drawingWithoutFilesCount: number;
};

type ComparableField = keyof Pick<WeeklyPlanDiffSourceOrder,
  | 'customerName'
  | 'productName'
  | 'specification'
  | 'processName'
  | 'uncompletedQty'
  | 'unitWorkHours'
  | 'totalWorkHours'
  | 'drawingStatus'
  | 'deliveryDay'
  | 'plannedAt'
  | 'materialStatus'
  | 'salesperson'
  | 'remark'
>;

const comparableFields: Array<{ field: ComparableField; label: string }> = [
  { field: 'customerName', label: '客户' },
  { field: 'productName', label: '品名' },
  { field: 'specification', label: '规格' },
  { field: 'processName', label: '工序' },
  { field: 'uncompletedQty', label: '未交量' },
  { field: 'unitWorkHours', label: '工时' },
  { field: 'totalWorkHours', label: '总工时' },
  { field: 'drawingStatus', label: '图纸' },
  { field: 'deliveryDay', label: '交期' },
  { field: 'plannedAt', label: '计划日期' },
  { field: 'materialStatus', label: '配料' },
  { field: 'salesperson', label: '业务员' },
  { field: 'remark', label: '备注' },
];

export function normalizeWeeklyPlanCompareText(value?: string | null) {
  return String(value || '')
    .trim()
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

export function buildWorkOrderCompareKey(order: Pick<WeeklyPlanDiffSourceOrder, 'sourceOrderNo' | 'customerName' | 'specification' | 'productName' | 'processName'>) {
  const sourceOrderNo = normalizeWeeklyPlanCompareText(order.sourceOrderNo);
  if (sourceOrderNo) return `SO::${sourceOrderNo}`;
  return [
    'FIELDS',
    normalizeWeeklyPlanCompareText(order.customerName),
    normalizeWeeklyPlanCompareText(order.specification),
    normalizeWeeklyPlanCompareText(order.productName),
    normalizeWeeklyPlanCompareText(order.processName),
  ].join('::');
}

function dateValue(value: Date | null) {
  return value && !Number.isNaN(value.getTime()) ? value.toISOString().slice(0, 10) : '';
}

function displayValue(value: string | Date | null) {
  if (value instanceof Date) return dateValue(value) || '未设置';
  const text = String(value || '').trim();
  return text || '未设置';
}

function normalizedFieldValue(value: string | Date | null) {
  if (value instanceof Date) return dateValue(value);
  return normalizeWeeklyPlanCompareText(value);
}

function drawingMeta(order: WeeklyPlanDiffSourceOrder, totalCategoryCount: number) {
  const item = order.drawingLibraryItem;
  const linked = !!order.drawingLibraryItemId && !!item && !item.deletedAt;
  const files = linked ? item.files : [];
  const filled = Math.min(totalCategoryCount, new Set(files.map(file => file.categoryId)).size);
  return {
    linked,
    completeness: `${filled}/${totalCategoryCount}`,
    fileCount: files.length,
  };
}

function serializeOrder(order: WeeklyPlanDiffSourceOrder, totalCategoryCount: number): WeeklyPlanOrderView {
  const drawing = drawingMeta(order, totalCategoryCount);
  return {
    id: order.id,
    code: order.code,
    customerName: order.customerName,
    productName: order.productName,
    specification: order.specification,
    processName: order.processName,
    sourceOrderNo: order.sourceOrderNo,
    uncompletedQty: order.uncompletedQty,
    unitWorkHours: order.unitWorkHours,
    totalWorkHours: order.totalWorkHours,
    drawingStatus: order.drawingStatus,
    deliveryDay: order.deliveryDay,
    plannedAt: dateValue(order.plannedAt) || null,
    materialStatus: order.materialStatus,
    salesperson: order.salesperson,
    remark: order.remark,
    weekStartDate: dateValue(order.weekStartDate) || null,
    weekEndDate: dateValue(order.weekEndDate) || null,
    drawingLibraryItemId: linkedDrawingId(order, drawing.linked),
    drawingLibraryLinked: drawing.linked,
    drawingLibraryCompleteness: drawing.completeness,
    drawingLibraryFileCount: drawing.fileCount,
  };
}

function linkedDrawingId(order: WeeklyPlanDiffSourceOrder, linked: boolean) {
  return linked ? order.drawingLibraryItemId : null;
}

function issue(
  code: string,
  label: string,
  message: string,
  level: WeeklyPlanIssueLevel,
  scope: WeeklyPlanIssueScope,
  field?: string,
): WeeklyPlanIssue {
  return { code, label, message, level, scope, ...(field ? { field } : {}) };
}

function validateNextOrder(order: WeeklyPlanDiffSourceOrder, totalCategoryCount: number) {
  const blockers: WeeklyPlanIssue[] = [];
  const warnings: WeeklyPlanIssue[] = [];
  const drawing = drawingMeta(order, totalCategoryCount);

  if (!order.specification?.trim()) blockers.push(issue('missing_specification', '规格缺失', '规格不能为空', 'blocking', 'next', 'specification'));
  if (!order.customerName?.trim()) blockers.push(issue('missing_customer', '客户缺失', '客户不能为空', 'blocking', 'next', 'customerName'));
  if (!order.weekStartDate) blockers.push(issue('missing_week_start', '计划周缺失', '下周工单缺少周开始日期', 'blocking', 'next', 'weekStartDate'));
  if (!order.plannedAt && !order.deliveryDay?.trim()) {
    blockers.push(issue('missing_delivery', '交期缺失', '计划日期和交期不能同时为空', 'blocking', 'next', 'plannedAt'));
  }

  if (!order.productName?.trim()) warnings.push(issue('missing_product', '品名缺失', '品名为空', 'warning', 'next', 'productName'));
  if (!drawing.linked) warnings.push(issue('drawing_library_unlinked', '图纸资料未关联', '尚未建立或关联图纸资料', 'warning', 'next', 'drawingLibraryItemId'));
  if (drawing.fileCount === 0) warnings.push(issue('drawing_library_empty', '图纸资料为空', '图纸资料完整度为 0/5', 'warning', 'next'));
  if (!order.drawingStatus?.trim()) warnings.push(issue('missing_drawing_status', '图纸状态缺失', '图纸状态为空', 'warning', 'next', 'drawingStatus'));
  if (!order.materialStatus?.trim()) warnings.push(issue('missing_material_status', '配料状态缺失', '配料状态为空', 'warning', 'next', 'materialStatus'));
  if (!order.uncompletedQty?.trim()) warnings.push(issue('missing_uncompleted_qty', '未交量缺失', '未交量为空', 'warning', 'next', 'uncompletedQty'));
  return { blockers, warnings };
}

function changedFields(current: WeeklyPlanDiffSourceOrder, next: WeeklyPlanDiffSourceOrder) {
  return comparableFields.flatMap(({ field, label }) => {
    const before = current[field];
    const after = next[field];
    if (normalizedFieldValue(before) === normalizedFieldValue(after)) return [];
    return [{ field, label, before: displayValue(before), after: displayValue(after) }];
  });
}

function groupByCompareKey(orders: WeeklyPlanDiffSourceOrder[]) {
  const map = new Map<string, WeeklyPlanDiffSourceOrder[]>();
  for (const order of orders) {
    const key = buildWorkOrderCompareKey(order);
    const group = map.get(key) || [];
    group.push(order);
    map.set(key, group);
  }
  return map;
}

function sourceOrderConflicts(orders: WeeklyPlanDiffSourceOrder[]) {
  const values = new Map<string, Set<string>>();
  for (const order of orders) {
    const source = normalizeWeeklyPlanCompareText(order.sourceOrderNo);
    if (!source) continue;
    const identity = `${normalizeWeeklyPlanCompareText(order.customerName)}::${normalizeWeeklyPlanCompareText(order.specification)}`;
    const identities = values.get(source) || new Set<string>();
    identities.add(identity);
    values.set(source, identities);
  }
  return new Set(Array.from(values.entries()).filter(([, identities]) => identities.size > 1).map(([source]) => source));
}

function hasCriticalDataBlocker(blockers: WeeklyPlanIssue[]) {
  return blockers.some(item => !['duplicate_compare_key'].includes(item.code));
}

export function compareWeeklyPlans(
  currentOrders: WeeklyPlanDiffSourceOrder[],
  nextOrders: WeeklyPlanDiffSourceOrder[],
  configuredCategoryCount = 5,
) {
  const totalCategoryCount = Math.max(5, configuredCategoryCount || 0);
  const currentGroups = groupByCompareKey(currentOrders);
  const nextGroups = groupByCompareKey(nextOrders);
  const currentSourceConflicts = sourceOrderConflicts(currentOrders);
  const nextSourceConflicts = sourceOrderConflicts(nextOrders);
  const keys = new Set([...currentGroups.keys(), ...nextGroups.keys()]);
  const items: WeeklyPlanDiffItem[] = [];

  for (const compareKey of keys) {
    const currentGroup = currentGroups.get(compareKey) || [];
    const nextGroup = nextGroups.get(compareKey) || [];
    const current = currentGroup[0] || null;
    const next = nextGroup[0] || null;
    const blockers: WeeklyPlanIssue[] = [];
    const warnings: WeeklyPlanIssue[] = [];
    let changes: WeeklyPlanFieldChange[] = [];

    if (next) {
      const validation = validateNextOrder(next, totalCategoryCount);
      blockers.push(...validation.blockers);
      warnings.push(...validation.warnings);
    }

    const duplicate = currentGroup.length > 1 || nextGroup.length > 1;
    if (duplicate) {
      blockers.push(issue(
        'duplicate_compare_key',
        '稳定键重复',
        `同一比较键在${currentGroup.length > 1 ? '当前周' : ''}${currentGroup.length > 1 && nextGroup.length > 1 ? '和' : ''}${nextGroup.length > 1 ? '下周草稿' : ''}存在多条工单`,
        'blocking',
        'comparison',
      ));
    }

    const source = normalizeWeeklyPlanCompareText(next?.sourceOrderNo || current?.sourceOrderNo);
    if (source && (currentSourceConflicts.has(source) || nextSourceConflicts.has(source))) {
      blockers.push(issue(
        'source_order_conflict',
        '来源订单冲突',
        '同一来源订单号对应多个客户或规格',
        'blocking',
        'comparison',
        'sourceOrderNo',
      ));
    }

    let baseType: WeeklyPlanBaseDiffType;
    if (!current && next) baseType = 'new';
    else if (current && !next) baseType = 'removed';
    else if (current && next) {
      changes = changedFields(current, next);
      baseType = changes.length ? 'changed' : 'continued';
    } else {
      continue;
    }
    const invalid = hasCriticalDataBlocker(blockers);
    const type: WeeklyPlanDiffType = invalid ? 'invalid' : duplicate ? 'duplicate' : baseType;
    const categories: WeeklyPlanDiffType[] = [baseType];
    if (duplicate) categories.push('duplicate');
    if (invalid) categories.push('invalid');

    items.push({
      id: `${type}:${compareKey}`,
      compareKey,
      type,
      baseType,
      categories,
      current: current ? serializeOrder(current, totalCategoryCount) : null,
      next: next ? serializeOrder(next, totalCategoryCount) : null,
      currentOrderIds: currentGroup.map(order => order.id),
      nextOrderIds: nextGroup.map(order => order.id),
      changes,
      blockers,
      warnings,
    });
  }

  const count = (type: WeeklyPlanDiffType) => items.filter(item => item.categories.includes(type)).length;
  const nextDrawing = nextOrders.map(order => drawingMeta(order, totalCategoryCount));
  const summary: WeeklyPlanDiffSummary = {
    currentCount: currentOrders.length,
    nextCount: nextOrders.length,
    newCount: count('new'),
    continuedCount: count('continued'),
    changedCount: count('changed'),
    removedCount: count('removed'),
    duplicateCount: count('duplicate'),
    invalidCount: count('invalid'),
    blockingAnomalyCount: items.filter(item => item.blockers.length > 0).length,
    blockingIssueCount: items.reduce((sum, item) => sum + item.blockers.length, 0),
    warningCount: items.filter(item => item.warnings.length > 0).length,
    warningIssueCount: items.reduce((sum, item) => sum + item.warnings.length, 0),
    drawingLinkedCount: nextDrawing.filter(item => item.linked).length,
    drawingUnlinkedCount: nextDrawing.filter(item => !item.linked).length,
    drawingWithFilesCount: nextDrawing.filter(item => item.fileCount > 0).length,
    drawingWithoutFilesCount: nextDrawing.filter(item => item.fileCount === 0).length,
  };

  return { items, summary };
}
