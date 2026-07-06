import type { WorkOrder } from '@prisma/client';
import { parseCsv } from '@/lib/data-tools';
import { legacyStatusForStage, normalizePriority, normalizeWorkOrderStage, parsePlannedAt, type WorkOrderStage } from '@/lib/work-orders';

export type WorkOrderImportMode = 'standard' | 'weekly_plan';
export type WorkOrderImportStatus = 'ready' | 'skipped' | 'invalid' | 'duplicate';
export type DuplicateStrategy = 'skip' | 'import';

export type WorkOrderImportData = {
  code: string;
  customerName: string | null;
  productName: string;
  stage: WorkOrderStage;
  priority: string;
  status: string;
  progress: number;
  plannedAt: string | null;
  remark: string | null;
  sourceOrderNo: string | null;
  salesperson: string | null;
  orderDate: string | null;
  customerLevel: string | null;
  specification: string | null;
  processName: string | null;
  uncompletedQty: string | null;
  unitWorkHours: string | null;
  totalWorkHours: string | null;
  drawingStatus: string | null;
  deliveryDay: string | null;
  materialStatus: string | null;
  drawingIssuedAt: string | null;
  drawingIssueNote: string | null;
  importBatchId?: string | null;
  sourceSheetName: string | null;
  sourceRowNo: number | null;
  planType: string | null;
  weekStartDate: string | null;
  weekEndDate: string | null;
  planActive: boolean;
  planClearedAt: string | null;
  planClearedBy: string | null;
  libraryKey: string | null;
};

export type WorkOrderImportPreviewRow = {
  rowNo: number;
  status: WorkOrderImportStatus;
  reason: string;
  code: string;
  workOrder: WorkOrderImportData;
};

export type WorkOrderImportSummary = {
  totalRows: number;
  readyCount: number;
  skippedCount: number;
  invalidCount: number;
  duplicateCount: number;
};

const standardHeaderMap: Record<string, keyof WorkOrderImportData> = {
  工单号: 'code',
  客户: 'customerName',
  客户名称: 'customerName',
  产品名称: 'productName',
  品名: 'productName',
  规格: 'specification',
  业务员: 'salesperson',
  来源订单号: 'sourceOrderNo',
  订单号: 'sourceOrderNo',
  阶段: 'stage',
  优先级: 'priority',
  状态: 'stage',
  进度: 'progress',
  计划时间: 'plannedAt',
  计划日期: 'plannedAt',
  备注: 'remark',
  code: 'code',
  customerName: 'customerName',
  productName: 'productName',
  specification: 'specification',
  salesperson: 'salesperson',
  sourceOrderNo: 'sourceOrderNo',
  stage: 'stage',
  priority: 'priority',
  status: 'stage',
  progress: 'progress',
  plannedAt: 'plannedAt',
  remark: 'remark',
};

const weeklyHeaderMap: Record<string, keyof WorkOrderImportData> = {
  订单日期: 'orderDate',
  业务员: 'salesperson',
  客户名称: 'customerName',
  客户等级: 'customerLevel',
  品名: 'productName',
  规格: 'specification',
  工序: 'processName',
  未交量: 'uncompletedQty',
  工时: 'unitWorkHours',
  总工时: 'totalWorkHours',
  图纸: 'drawingStatus',
  交期: 'deliveryDay',
  配料: 'materialStatus',
  备注: 'remark',
  图纸下发日期: 'drawingIssuedAt',
};

export const weeklyPlanHeaderNames = new Set(Object.keys(weeklyHeaderMap));
export const standardWorkOrderHeaderNames = new Set(Object.keys(standardHeaderMap));

const deliveryOffsets: Record<string, number> = {
  周一: 0,
  星期一: 0,
  周二: 1,
  星期二: 1,
  周三: 2,
  星期三: 2,
  周四: 3,
  星期四: 3,
  周五: 4,
  星期五: 4,
  周六: 5,
  星期六: 5,
  周日: 6,
  周天: 6,
  星期日: 6,
  星期天: 6,
};

function cleanText(value: unknown, max = 500) {
  const text = String(value ?? '').replace(/\u00a0/g, ' ').trim();
  return text ? text.slice(0, max) : '';
}

function nullableText(value: unknown, max = 500) {
  const text = cleanText(value, max);
  return text || null;
}

function localDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day, -8, 0, 0, 0));
}

function validYmd(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function chinaDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value || '';
  return { year: get('year'), month: get('month'), day: get('day') };
}

function formatCodeDate(date: Date) {
  const parts = chinaDateParts(date);
  return `${parts.year}${parts.month}${parts.day}`;
}

function dateOnlyIso(date: Date | null) {
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function addDays(date: Date | null, days: number) {
  if (!date) return null;
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function inferWeekStartDateFromFilename(filename = '', now = new Date()) {
  const match = filename.match(/(\d{1,2})[.-](\d{1,2})\s*-\s*(\d{1,2})[.-](\d{1,2})/);
  if (!match) return '';
  const year = now.getFullYear();
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseDateCell(value: unknown): { value: Date | null; error?: string } {
  if (value === null || value === undefined || value === '') return { value: null };
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? { value: null, error: '日期无法解析' } : { value };
  if (typeof value === 'number' && Number.isFinite(value)) {
    const epoch = Date.UTC(1899, 11, 30);
    return { value: new Date(epoch + value * 24 * 60 * 60 * 1000) };
  }

  const raw = cleanText(value);
  if (!raw) return { value: null };

  const ymd = raw.match(/^(\d{4})[\/.\-年](\d{1,2})[\/.\-月](\d{1,2})(?:日)?$/);
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]);
    const day = Number(ymd[3]);
    return validYmd(year, month, day) ? { value: localDate(year, month, day) } : { value: null, error: '日期无法解析' };
  }

  const mdy = raw.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/);
  if (mdy) {
    const year = Number(mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3]);
    const month = Number(mdy[1]);
    const day = Number(mdy[2]);
    return validYmd(year, month, day) ? { value: localDate(year, month, day) } : { value: null, error: '日期无法解析' };
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return { value: parsed };
  return { value: null, error: '日期无法解析' };
}

export function parseWeekStartDate(value?: string | null) {
  const raw = cleanText(value);
  if (!raw) return null;
  const parsed = parseDateCell(raw);
  return parsed.value;
}

function plannedAtFromDeliveryDay(deliveryDay: string | null, weekStartDate?: string | null) {
  if (!deliveryDay || !weekStartDate) return null;
  const base = parseWeekStartDate(weekStartDate);
  if (!base) return null;
  const offset = deliveryOffsets[deliveryDay.trim()];
  if (offset === undefined) return null;
  const next = new Date(base.getTime());
  next.setUTCDate(next.getUTCDate() + offset);
  return next;
}

function stageFromWeekly(drawingStatus: string | null, materialStatus: string | null): WorkOrderStage {
  const drawing = cleanText(drawingStatus);
  const material = cleanText(materialStatus);
  if (!drawing) return 'not_issued';
  if (drawing.includes('已发') && (material.includes('已配料') || material.includes('料齐'))) return 'backend';
  if (drawing.includes('已发')) return 'frontend';
  return 'not_issued';
}

function priorityFromWeekly(customerLevel: string | null, remark: string | null) {
  const level = cleanText(customerLevel).toUpperCase();
  const note = cleanText(remark);
  if (level === 'A') return 'high';
  if (level === 'B') return 'normal';
  if (note.includes('新品验证')) return 'normal';
  return 'normal';
}

function isTotalOrEmptyRow(row: string[]) {
  const values = row.map(cell => cleanText(cell));
  const joined = values.join(' ');
  if (!values.some(Boolean)) return '空行';
  if (/合计工时|滚动合计工时|本周\+上周计划滚动合计工时/.test(joined)) return '合计说明行';
  return '';
}

function rowObject(headers: string[], row: string[], map: Record<string, keyof WorkOrderImportData>) {
  const out: Record<string, string> = {};
  headers.forEach((header, index) => {
    const key = map[cleanText(header)];
    if (key) out[key] = cleanText(row[index]);
  });
  return out;
}

function makeBaseData(): WorkOrderImportData {
  return {
    code: '',
    customerName: null,
    productName: '',
    stage: 'not_issued',
    priority: 'normal',
    status: 'pending',
    progress: 0,
    plannedAt: null,
    remark: null,
    sourceOrderNo: null,
    salesperson: null,
    orderDate: null,
    customerLevel: null,
    specification: null,
    processName: null,
    uncompletedQty: null,
    unitWorkHours: null,
    totalWorkHours: null,
    drawingStatus: null,
    deliveryDay: null,
    materialStatus: null,
    drawingIssuedAt: null,
    drawingIssueNote: null,
    sourceSheetName: null,
    sourceRowNo: null,
    planType: 'manual',
    weekStartDate: null,
    weekEndDate: null,
    planActive: true,
    planClearedAt: null,
    planClearedBy: null,
    libraryKey: null,
  };
}

function makeCode(prefix: string, next: number) {
  return `${prefix}-${String(next).padStart(3, '0')}`;
}

function assignGeneratedCodes(rows: WorkOrderImportPreviewRow[], existingCodes: Set<string>) {
  const counters = new Map<string, number>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.status === 'skipped' || row.status === 'invalid') continue;
    const prefix = row.workOrder.plannedAt ? `WO-${formatCodeDate(new Date(row.workOrder.plannedAt))}` : 'WO-UNPLANNED';
    const next = (counters.get(prefix) || 0) + 1;
    counters.set(prefix, next);
    const code = makeCode(prefix, next);
    row.code = code;
    row.workOrder.code = code;
    if (existingCodes.has(code) || seen.has(code)) {
      row.status = 'duplicate';
      row.reason = '工单号已存在或批内重复';
    }
    seen.add(code);
  }
}

export function summarizeWorkOrderImport(rows: WorkOrderImportPreviewRow[]): WorkOrderImportSummary {
  return {
    totalRows: rows.length,
    readyCount: rows.filter(row => row.status === 'ready').length,
    skippedCount: rows.filter(row => row.status === 'skipped').length,
    invalidCount: rows.filter(row => row.status === 'invalid').length,
    duplicateCount: rows.filter(row => row.status === 'duplicate').length,
  };
}

export function findHeaderRow(rows: string[][], mode: WorkOrderImportMode) {
  const names = mode === 'weekly_plan' ? weeklyPlanHeaderNames : standardWorkOrderHeaderNames;
  for (let index = 0; index < rows.length; index += 1) {
    const known = rows[index].filter(cell => names.has(cleanText(cell))).length;
    if (known >= (mode === 'weekly_plan' ? 5 : 2)) return index;
  }
  return -1;
}

export function parseDelimitedWorkOrderText(textValue: string) {
  const normalized = textValue.replace(/^\uFEFF/, '').trim();
  if (!normalized) return [];
  if ((normalized.split(/\r?\n/)[0] || '').includes('\t')) {
    return normalized.split(/\r?\n/).map(line => line.split('\t').map(cell => cleanText(cell)));
  }
  return parseCsv(normalized);
}

export function buildStandardWorkOrderPreview(options: {
  headers: string[];
  rows: string[][];
  startRowNo: number;
  existingCodes: Set<string>;
}) {
  const seen = new Set<string>();
  return options.rows.map((row, index): WorkOrderImportPreviewRow => {
    const rowNo = options.startRowNo + index;
    if (!row.some(cell => cleanText(cell))) {
      const empty = makeBaseData();
      empty.sourceRowNo = rowNo;
      return { rowNo, status: 'skipped', reason: '空行', code: '-', workOrder: empty };
    }
    const raw = rowObject(options.headers, row, standardHeaderMap);
    const data = makeBaseData();
    const errors: string[] = [];
    const code = cleanText(raw.code, 80);
    const productName = cleanText(raw.productName, 120);
    if (!code) errors.push('工单号必填');
    if (!productName) errors.push('产品名称必填');
    const stage = normalizeWorkOrderStage(raw.stage || '未发图');
    if (!stage) errors.push('状态不合法');
    const priority = normalizePriority(raw.priority || '一般');
    if (!priority) errors.push('优先级不正确');
    const progress = Number(raw.progress || 0);
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) errors.push('进度必须在 0-100 之间');
    const planned = parsePlannedAt(raw.plannedAt);
    if (planned.error) errors.push(planned.error);

    data.code = code;
    data.customerName = nullableText(raw.customerName, 120);
    data.productName = productName;
    data.specification = nullableText(raw.specification, 180);
    data.libraryKey = data.specification || code || null;
    data.salesperson = nullableText(raw.salesperson, 120);
    data.sourceOrderNo = nullableText(raw.sourceOrderNo, 120);
    data.stage = stage || 'not_issued';
    data.priority = priority || 'normal';
    data.status = legacyStatusForStage(data.stage);
    data.progress = Math.round(progress || 0);
    data.plannedAt = dateOnlyIso(planned.value ?? null);
    data.remark = nullableText(raw.remark, 800);
    data.sourceRowNo = rowNo;

    const duplicate = code && (options.existingCodes.has(code) || seen.has(code));
    seen.add(code);
    return {
      rowNo,
      status: errors.length ? 'invalid' : duplicate ? 'duplicate' : 'ready',
      reason: errors.join('；') || (duplicate ? '工单号已存在或批内重复' : ''),
      code: code || '-',
      workOrder: data,
    };
  });
}

export function buildWeeklyPlanPreview(options: {
  headers: string[];
  rows: string[][];
  startRowNo: number;
  weekStartDate?: string | null;
  sourceSheetName?: string | null;
  existingCodes: Set<string>;
}) {
  const weekStart = parseWeekStartDate(options.weekStartDate);
  const weekEnd = addDays(weekStart, 6);
  const previewRows = options.rows.map((row, index): WorkOrderImportPreviewRow => {
    const rowNo = options.startRowNo + index;
    const skipReason = isTotalOrEmptyRow(row);
    const raw = rowObject(options.headers, row, weeklyHeaderMap);
    const data = makeBaseData();
    data.sourceSheetName = options.sourceSheetName || null;
    data.sourceRowNo = rowNo;

    if (skipReason) return { rowNo, status: 'skipped', reason: skipReason, code: '-', workOrder: data };

    let salesperson = nullableText(raw.salesperson, 120);
    let customerName = nullableText(raw.customerName, 160);
    let customerLevel = nullableText(raw.customerLevel, 80);
    let sourceOrderNo: string | null = null;
    if (salesperson && /^SO\d+/i.test(salesperson)) {
      sourceOrderNo = salesperson;
      salesperson = customerName;
      customerName = customerLevel;
      customerLevel = null;
    }

    const specification = nullableText(raw.specification, 180);
    const productName = nullableText(raw.productName, 180) || specification || '';
    const totalWorkHours = nullableText(raw.totalWorkHours, 80);
    if (!productName && !specification) {
      return {
        rowNo,
        status: 'skipped',
        reason: totalWorkHours ? '合计/说明行，缺少品名和规格' : '缺少品名和规格',
        code: '-',
        workOrder: data,
      };
    }

    const errors: string[] = [];
    const orderDate = parseDateCell(raw.orderDate);
    if (raw.orderDate && orderDate.error) errors.push('订单日期无法解析');

    const drawingDate = parseDateCell(raw.drawingIssuedAt);
    const drawingIssueNote = drawingDate.value ? null : nullableText(raw.drawingIssuedAt, 200);
    const deliveryDay = nullableText(raw.deliveryDay, 40);
    const plannedAt = plannedAtFromDeliveryDay(deliveryDay, options.weekStartDate);
    if (deliveryDay && !plannedAt && options.weekStartDate) errors.push('交期日期无法解析');

    const drawingStatus = nullableText(raw.drawingStatus, 80);
    const materialStatus = nullableText(raw.materialStatus, 200);
    const stage = stageFromWeekly(drawingStatus, materialStatus);
    const priority = priorityFromWeekly(customerLevel, raw.remark);

    data.customerName = customerName;
    data.productName = productName.slice(0, 120);
    data.stage = stage;
    data.priority = priority;
    data.status = legacyStatusForStage(stage);
    data.progress = stage === 'backend' ? 60 : stage === 'frontend' ? 35 : stage === 'completed' ? 100 : 0;
    data.plannedAt = dateOnlyIso(plannedAt);
    data.remark = nullableText(raw.remark, 800);
    data.sourceOrderNo = sourceOrderNo;
    data.salesperson = salesperson;
    data.orderDate = dateOnlyIso(orderDate.value);
    data.customerLevel = customerLevel;
    data.specification = specification;
    data.planType = 'weekly_plan';
    data.weekStartDate = dateOnlyIso(weekStart);
    data.weekEndDate = dateOnlyIso(weekEnd);
    data.planActive = true;
    data.libraryKey = specification;
    data.processName = nullableText(raw.processName, 120);
    data.uncompletedQty = nullableText(raw.uncompletedQty, 80);
    data.unitWorkHours = nullableText(raw.unitWorkHours, 80);
    data.totalWorkHours = totalWorkHours;
    data.drawingStatus = drawingStatus;
    data.deliveryDay = deliveryDay;
    data.materialStatus = materialStatus;
    data.drawingIssuedAt = dateOnlyIso(drawingDate.value);
    data.drawingIssueNote = drawingIssueNote;

    return {
      rowNo,
      status: errors.length ? 'invalid' : 'ready',
      reason: errors.join('；'),
      code: '',
      workOrder: data,
    };
  });

  assignGeneratedCodes(previewRows, options.existingCodes);
  return previewRows;
}

export function toWorkOrderCreateData(row: WorkOrderImportPreviewRow, importBatchId: string) {
  const item = row.workOrder;
  return {
    code: cleanText(item.code, 80),
    customerName: nullableText(item.customerName, 160),
    productName: cleanText(item.productName, 120),
    stage: item.stage,
    priority: item.priority,
    status: item.status,
    progress: Number(item.progress || 0),
    plannedAt: item.plannedAt ? new Date(item.plannedAt) : null,
    remark: nullableText(item.remark, 800),
    sourceOrderNo: nullableText(item.sourceOrderNo, 120),
    salesperson: nullableText(item.salesperson, 120),
    orderDate: item.orderDate ? new Date(item.orderDate) : null,
    customerLevel: nullableText(item.customerLevel, 80),
    specification: nullableText(item.specification, 180),
    processName: nullableText(item.processName, 120),
    uncompletedQty: nullableText(item.uncompletedQty, 80),
    unitWorkHours: nullableText(item.unitWorkHours, 80),
    totalWorkHours: nullableText(item.totalWorkHours, 80),
    drawingStatus: nullableText(item.drawingStatus, 80),
    deliveryDay: nullableText(item.deliveryDay, 40),
    materialStatus: nullableText(item.materialStatus, 200),
    drawingIssuedAt: item.drawingIssuedAt ? new Date(item.drawingIssuedAt) : null,
    drawingIssueNote: nullableText(item.drawingIssueNote, 200),
    importBatchId,
    sourceSheetName: nullableText(item.sourceSheetName, 160),
    sourceRowNo: item.sourceRowNo ? Number(item.sourceRowNo) : null,
    planType: nullableText(item.planType, 40) || 'manual',
    weekStartDate: item.weekStartDate ? new Date(item.weekStartDate) : null,
    weekEndDate: item.weekEndDate ? new Date(item.weekEndDate) : null,
    planActive: item.planActive !== false,
    planClearedAt: item.planClearedAt ? new Date(item.planClearedAt) : null,
    planClearedBy: nullableText(item.planClearedBy, 120),
    libraryKey: nullableText(item.libraryKey, 180) || nullableText(item.specification, 180) || cleanText(item.code, 80),
  };
}

export async function nextUniqueCode(baseCode: string, exists: (code: string) => Promise<boolean>) {
  if (!(await exists(baseCode))) return baseCode;
  for (let i = 1; i <= 999; i += 1) {
    const suffix = `-R${String(i).padStart(3, '0')}`;
    const candidate = `${baseCode.slice(0, 80 - suffix.length)}${suffix}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error('无法生成唯一工单号');
}

export function serializeImportedWorkOrderFields(order: WorkOrder) {
  return {
    sourceOrderNo: order.sourceOrderNo,
    salesperson: order.salesperson,
    orderDate: order.orderDate?.toISOString() || null,
    customerLevel: order.customerLevel,
    specification: order.specification,
    processName: order.processName,
    uncompletedQty: order.uncompletedQty,
    unitWorkHours: order.unitWorkHours,
    totalWorkHours: order.totalWorkHours,
    drawingStatus: order.drawingStatus,
    deliveryDay: order.deliveryDay,
    materialStatus: order.materialStatus,
    drawingIssuedAt: order.drawingIssuedAt?.toISOString() || null,
    drawingIssueNote: order.drawingIssueNote,
    importBatchId: order.importBatchId,
    sourceSheetName: order.sourceSheetName,
    sourceRowNo: order.sourceRowNo,
    planType: order.planType,
    weekStartDate: order.weekStartDate?.toISOString() || null,
    weekEndDate: order.weekEndDate?.toISOString() || null,
    planActive: order.planActive,
    planClearedAt: order.planClearedAt?.toISOString() || null,
    planClearedBy: order.planClearedBy,
    libraryKey: order.libraryKey,
  };
}
