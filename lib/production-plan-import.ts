import { createHash } from 'node:crypto';
import { drawingLibraryKey, invalidSpecificationReason } from '@/lib/drawing-library';
import { chinaDate, parsePlanDate } from '@/lib/production-planning';
import { normalizePlanningProductText, planningProductIdentity } from '@/lib/planning-product-link';

export const PRODUCTION_PLAN_IMPORT_MAX_ROWS = 1000;

export type ProductionPlanImportStatus = 'ready' | 'duplicate' | 'conflict' | 'invalid' | 'skipped';
export type ProductionPlanImportProductAction = 'reuse' | 'restore' | 'create' | 'conflict' | 'none';

export type ProductionPlanImportInput = {
  sourceOrderNo: string;
  sourceLineNo: number;
  orderDate: string;
  customerName: string;
  productName: string;
  specification: string;
  orderQuantity: number;
  plannedQuantity: number;
  customerDueDate: string;
  plannedCompletionDate: string;
  drawingLibraryRef: string | null;
  customerLevel: 'A' | 'B' | 'C' | 'D' | null;
  salesperson: string | null;
  remark: string | null;
};

export type ProductionPlanImportCandidate = {
  id: string;
  libraryKey: string;
  customerName: string;
  productName: string | null;
  specification: string;
  deletedAt: string | null;
  drawingFileCount: number;
  sopFileCount: number;
  productTimeVersion: number | null;
};

export type ProductionPlanImportExistingOrder = {
  id: string;
  sourceOrderNo: string;
  sourceLineNo: number;
  drawingLibraryItemId: string | null;
  customerDueDate: string;
  status: string;
  deletedAt: string | null;
  batchWeekStartDates: string[];
};

export type ProductionPlanImportRow = {
  rowNo: number;
  status: ProductionPlanImportStatus;
  reason: string;
  warning: string | null;
  productAction: ProductionPlanImportProductAction;
  matchedDrawingLibraryItemId: string | null;
  candidates: ProductionPlanImportCandidate[];
  existingPlanOrderId: string | null;
  input: ProductionPlanImportInput | null;
};

export type ProductionPlanImportSummary = {
  totalRows: number;
  readyCount: number;
  reuseCount: number;
  restoreCount: number;
  createCount: number;
  duplicateCount: number;
  conflictCount: number;
  invalidCount: number;
  skippedCount: number;
};

export type ProductionPlanImportPreview = {
  batchId: string;
  requestId: string;
  previewToken: string;
  sourceFileName: string;
  sourceSheetName: string | null;
  targetWeekStartDate: string;
  targetWeekEndDate: string;
  summary: ProductionPlanImportSummary;
  rows: ProductionPlanImportRow[];
};

const headerAliases: Record<string, keyof ProductionPlanImportInput> = {
  来源订单号: 'sourceOrderNo', 订单号: 'sourceOrderNo',
  订单行号: 'sourceLineNo', 行号: 'sourceLineNo',
  订单日期: 'orderDate',
  客户名称: 'customerName', 客户: 'customerName',
  产品名称: 'productName', 品名: 'productName',
  '型号/规格': 'specification', 规格: 'specification', 型号规格: 'specification',
  订单总量: 'orderQuantity', 订单数量: 'orderQuantity',
  本周排产量: 'plannedQuantity', 排产数量: 'plannedQuantity',
  客户交期: 'customerDueDate', 交期: 'customerDueDate',
  计划完成日期: 'plannedCompletionDate', 内部完成日期: 'plannedCompletionDate',
  图纸库编号: 'drawingLibraryRef', 图纸库ID: 'drawingLibraryRef',
  客户等级: 'customerLevel', 业务员: 'salesperson', 备注: 'remark',
};

const requiredHeaders: Array<keyof ProductionPlanImportInput> = [
  'sourceOrderNo', 'sourceLineNo', 'orderDate', 'customerName', 'productName',
  'specification', 'orderQuantity', 'plannedQuantity', 'customerDueDate',
];

function clean(value: unknown, max = 200): string {
  return String(value ?? '').replace(/\u00a0/g, ' ').trim().slice(0, max);
}

function headerKey(value: unknown): string {
  return clean(value).replace(/[＊*]\s*$/, '').trim();
}

function integer(value: unknown): number | null {
  const source = clean(value, 80).replace(/,/g, '').replace(/件|套|根|个/g, '');
  const parsed = Number(source);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function dateOnly(value: unknown): string | null {
  const source = clean(value, 60).replace(/[./]/g, '-');
  const parsed = parsePlanDate(source);
  return parsed ? chinaDate(parsed) : null;
}

function rowKey(sourceOrderNo: string, sourceLineNo: number): string {
  return `${normalizePlanningProductText(sourceOrderNo)}::${sourceLineNo}`;
}

function isBlankOrSummary(row: string[]): string | null {
  const values = row.map(value => clean(value));
  if (!values.some(Boolean)) return '空行';
  const joined = values.slice(0, 4).join('');
  return /^(合计|总计|说明|备注)/.test(joined) ? '合计/说明行' : null;
}

export function findProductionPlanImportHeaderRow(rows: string[][]): number {
  for (let index = 0; index < rows.length; index += 1) {
    const mapped = new Set(rows[index].map(value => headerAliases[headerKey(value)]).filter(Boolean));
    if (requiredHeaders.every(header => mapped.has(header))) return index;
  }
  return -1;
}

export function productionPlanImportHeaderNames(): string[] {
  return Object.keys(headerAliases);
}

function candidateCatalog(items: readonly ProductionPlanImportCandidate[]) {
  const byId = new Map(items.map(item => [item.id, item]));
  const byLibraryRef = new Map<string, ProductionPlanImportCandidate[]>();
  const byIdentity = new Map<string, ProductionPlanImportCandidate[]>();
  for (const item of items) {
    for (const value of [item.id, item.libraryKey]) {
      const key = normalizePlanningProductText(value);
      byLibraryRef.set(key, [...(byLibraryRef.get(key) || []), item]);
    }
    const identity = planningProductIdentity(item.customerName, item.specification);
    byIdentity.set(identity, [...(byIdentity.get(identity) || []), item]);
  }
  return { byId, byLibraryRef, byIdentity };
}

function productMatch(
  input: ProductionPlanImportInput,
  existing: ProductionPlanImportExistingOrder | null,
  catalog: ReturnType<typeof candidateCatalog>,
): Pick<ProductionPlanImportRow, 'status' | 'reason' | 'productAction' | 'matchedDrawingLibraryItemId' | 'candidates'> {
  const linked = existing?.drawingLibraryItemId ? catalog.byId.get(existing.drawingLibraryItemId) : null;
  if (linked) {
    return {
      status: 'ready', reason: '', productAction: linked.deletedAt ? 'restore' : 'reuse',
      matchedDrawingLibraryItemId: linked.id, candidates: [linked],
    };
  }

  let candidates: ProductionPlanImportCandidate[];
  if (input.drawingLibraryRef) {
    candidates = catalog.byLibraryRef.get(normalizePlanningProductText(input.drawingLibraryRef)) || [];
    if (!candidates.length) {
      return {
        status: 'invalid', reason: `图纸库编号 ${input.drawingLibraryRef} 不存在`, productAction: 'none',
        matchedDrawingLibraryItemId: null, candidates: [],
      };
    }
  } else {
    candidates = catalog.byIdentity.get(planningProductIdentity(input.customerName, input.specification)) || [];
  }

  if (candidates.length > 1) {
    return {
      status: 'conflict', reason: '匹配到多个图纸库，请选择原有档案；系统不会新建第三个档案',
      productAction: 'conflict', matchedDrawingLibraryItemId: null, candidates,
    };
  }
  if (candidates.length === 1) {
    return {
      status: 'ready', reason: '', productAction: candidates[0].deletedAt ? 'restore' : 'reuse',
      matchedDrawingLibraryItemId: candidates[0].id, candidates,
    };
  }
  return {
    status: 'ready', reason: '', productAction: 'create', matchedDrawingLibraryItemId: null, candidates: [],
  };
}

export function buildProductionPlanImportRows(options: {
  headers: string[];
  rows: string[][];
  startRowNo: number;
  targetWeekStartDate: string;
  targetWeekEndDate: string;
  libraryItems: ProductionPlanImportCandidate[];
  existingOrders: ProductionPlanImportExistingOrder[];
}): ProductionPlanImportRow[] {
  const mappedHeaders = options.headers.map(header => headerAliases[headerKey(header)] || null);
  const orderMap = new Map(options.existingOrders.map(order => [rowKey(order.sourceOrderNo, order.sourceLineNo), order]));
  const catalog = candidateCatalog(options.libraryItems);
  const seen = new Set<string>();

  return options.rows.map((rawRow, index): ProductionPlanImportRow => {
    const rowNo = options.startRowNo + index;
    const skipReason = isBlankOrSummary(rawRow);
    if (skipReason) return {
      rowNo, status: 'skipped', reason: skipReason, warning: null, productAction: 'none',
      matchedDrawingLibraryItemId: null, candidates: [], existingPlanOrderId: null, input: null,
    };

    const raw: Record<string, string> = {};
    for (let cell = 0; cell < mappedHeaders.length; cell += 1) {
      const key = mappedHeaders[cell];
      if (key) raw[key] = clean(rawRow[cell], 500);
    }
    const errors: string[] = [];
    const sourceOrderNo = clean(raw.sourceOrderNo, 120);
    const sourceLineNo = integer(raw.sourceLineNo);
    const orderDate = dateOnly(raw.orderDate);
    const customerName = clean(raw.customerName, 120);
    const productName = clean(raw.productName, 160);
    const specification = clean(raw.specification, 180);
    const orderQuantity = integer(raw.orderQuantity);
    const plannedQuantity = integer(raw.plannedQuantity);
    const customerDueDate = dateOnly(raw.customerDueDate);
    const plannedCompletionDate = dateOnly(raw.plannedCompletionDate) || options.targetWeekEndDate;
    const rawLevel = clean(raw.customerLevel, 10).toUpperCase();
    const customerLevel = rawLevel ? (['A', 'B', 'C', 'D'].includes(rawLevel) ? rawLevel as 'A' | 'B' | 'C' | 'D' : null) : null;
    if (!sourceOrderNo) errors.push('来源订单号必填');
    if (!sourceLineNo) errors.push('订单行号必须是正整数');
    if (!orderDate) errors.push('订单日期无法解析');
    if (!customerName) errors.push('客户名称必填');
    if (!productName) errors.push('产品名称必填');
    if (!specification) errors.push('型号/规格必填');
    else {
      const specificationError = invalidSpecificationReason(specification);
      if (specificationError) errors.push(specificationError);
    }
    if (!orderQuantity) errors.push('订单总量必须是正整数');
    if (!plannedQuantity) errors.push('本周排产量必须是正整数');
    if (orderQuantity && plannedQuantity && plannedQuantity > orderQuantity) errors.push('本周排产量不能大于订单总量');
    if (!customerDueDate) errors.push('客户交期无法解析');
    if (raw.plannedCompletionDate && !dateOnly(raw.plannedCompletionDate)) errors.push('计划完成日期无法解析');
    if (plannedCompletionDate < options.targetWeekStartDate || plannedCompletionDate > options.targetWeekEndDate) {
      errors.push('计划完成日期必须位于目标生产周内');
    }
    if (rawLevel && !customerLevel) errors.push('客户等级只能填写 A、B、C 或 D');

    if (errors.length || !sourceLineNo || !orderDate || !orderQuantity || !plannedQuantity || !customerDueDate) {
      return {
        rowNo, status: 'invalid', reason: errors.join('；'), warning: null, productAction: 'none',
        matchedDrawingLibraryItemId: null, candidates: [], existingPlanOrderId: null, input: null,
      };
    }

    const input: ProductionPlanImportInput = {
      sourceOrderNo, sourceLineNo, orderDate, customerName, productName, specification,
      orderQuantity, plannedQuantity, customerDueDate, plannedCompletionDate,
      drawingLibraryRef: clean(raw.drawingLibraryRef, 180) || null,
      customerLevel,
      salesperson: clean(raw.salesperson, 80) || null,
      remark: clean(raw.remark, 500) || null,
    };
    const key = rowKey(sourceOrderNo, sourceLineNo);
    const existing = orderMap.get(key) || null;
    if (seen.has(key)) {
      return {
        rowNo, status: 'duplicate', reason: '文件内来源订单号和行号重复，仅保留第一行', warning: null,
        productAction: 'none', matchedDrawingLibraryItemId: null, candidates: [],
        existingPlanOrderId: existing?.id || null, input,
      };
    }
    seen.add(key);
    if (existing?.batchWeekStartDates.includes(options.targetWeekStartDate)) {
      return {
        rowNo, status: 'duplicate', reason: '该订单行在目标周已经排产，已自动跳过', warning: null,
        productAction: 'none', matchedDrawingLibraryItemId: existing.drawingLibraryItemId,
        candidates: [], existingPlanOrderId: existing.id, input,
      };
    }
    if (existing && !existing.deletedAt && (existing.status === 'cancelled' || existing.status === 'completed')) {
      return {
        rowNo, status: 'invalid', reason: '该来源订单行已经完成或取消，不能追加批次', warning: null,
        productAction: 'none', matchedDrawingLibraryItemId: existing.drawingLibraryItemId,
        candidates: [], existingPlanOrderId: existing.id, input,
      };
    }

    const match = productMatch(input, existing, catalog);
    const warning = existing && existing.customerDueDate !== customerDueDate
      ? `导入交期 ${customerDueDate} 与现有交期 ${existing.customerDueDate} 不同，将保留现有交期`
      : null;
    return {
      rowNo, ...match, warning, existingPlanOrderId: existing?.id || null, input,
    };
  });
}

export function summarizeProductionPlanImport(rows: ProductionPlanImportRow[]): ProductionPlanImportSummary {
  return {
    totalRows: rows.length,
    readyCount: rows.filter(row => row.status === 'ready').length,
    reuseCount: rows.filter(row => row.status === 'ready' && row.productAction === 'reuse').length,
    restoreCount: rows.filter(row => row.status === 'ready' && row.productAction === 'restore').length,
    createCount: rows.filter(row => row.status === 'ready' && row.productAction === 'create').length,
    duplicateCount: rows.filter(row => row.status === 'duplicate').length,
    conflictCount: rows.filter(row => row.status === 'conflict').length,
    invalidCount: rows.filter(row => row.status === 'invalid').length,
    skippedCount: rows.filter(row => row.status === 'skipped').length,
  };
}

export function productionPlanImportPreviewToken(input: {
  sourceFileHash: string;
  targetWeekStartDate: string;
  targetWeekEndDate: string;
  rows: ProductionPlanImportRow[];
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export function productionPlanImportBusinessKey(input: ProductionPlanImportInput): string {
  return rowKey(input.sourceOrderNo, input.sourceLineNo);
}

export function productionPlanImportIdentity(input: ProductionPlanImportInput): string {
  return planningProductIdentity(input.customerName, input.specification);
}

export function productionPlanImportLibraryKey(input: ProductionPlanImportInput): string {
  return drawingLibraryKey(input.customerName, input.specification);
}
