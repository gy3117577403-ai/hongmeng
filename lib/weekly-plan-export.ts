import ExcelJS, { type Cell, type Worksheet } from 'exceljs';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  activeProductionCarryoverLinkWhere,
  PRODUCTION_CARRYOVER_AUTO,
  productionCarryoverDayWindow,
} from '@/lib/production-carryovers';
import {
  naturalProductionWeek,
  productionExecutionInclude,
  serializeProductionOrder,
} from '@/lib/production-execution';
import {
  chinaDate,
  productionPlanOrderInclude,
  serializeProductionPlanOrder,
} from '@/lib/production-planning';
import {
  productionTeamScopeWhere,
  type ProductionEntityScope,
} from '@/lib/production-access-scope';
import { planningSopStage, planningSopStageLabels } from '@/lib/planning-sop';
import { resolvePlanningFlow } from '@/lib/planning-flow';
import { addDays } from '@/lib/weekly-work-orders';
import type { ProductionPlanBatchDTO, ProductionPlanOrderDTO } from '@/types';

export const WEEKLY_PLAN_EXPORT_MAX_BATCHES = 5000;

export type WeeklyPlanExportVersion = 'full' | 'orders';
export type WeeklyPlanExportRange = 'execution' | 'current';
export type WeeklyPlanCarryoverKind = 'previous' | 'older' | null;

export class WeeklyPlanExportError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 400) {
    super(message);
  }
}

export type WeeklyPlanExportRow = {
  planOrderId: string;
  batchId: string;
  workOrderId: string | null;
  orderNo: string;
  customerName: string;
  productName: string;
  salesperson: string;
  specification: string;
  batchNo: number;
  scheduledQuantity: number | null;
  originalBatchQuantity: number;
  completedQuantity: number | null;
  orderQuantity: number;
  weekLabel: string;
  plannedCompletionDate: string;
  customerDueDate: string;
  unitHours: number | null;
  totalHours: number | null;
  drawingStatus: string;
  sopStatus: string;
  documentRegistrationStatus: string;
  warehouseStatus: string;
  processStatus: string;
  flowStatus: string;
  printStatus: string;
  exceptionType: string;
  remark: string;
  carryoverKind: WeeklyPlanCarryoverKind;
  carryoverWeeksOld: number;
  carryoverReason: string | null;
  inclusionType: string | null;
};

export type WeeklyPlanExportSummary = {
  batchCount: number;
  orderCount: number;
  quantity: number;
  totalHours: number;
  quantityMissingCount: number;
  hoursMissingCount: number;
};

export type WeeklyPlanExportDataset = {
  weekStartDate: string;
  weekEndDate: string;
  currentRows: WeeklyPlanExportRow[];
  previousCarryoverRows: WeeklyPlanExportRow[];
  olderCarryoverRows: WeeklyPlanExportRow[];
  rows: WeeklyPlanExportRow[];
  summary: {
    current: WeeklyPlanExportSummary;
    previousCarryover: WeeklyPlanExportSummary;
    olderCarryover: WeeklyPlanExportSummary;
    carryover: WeeklyPlanExportSummary;
    execution: WeeklyPlanExportSummary;
  };
};

type WeeklyPlanExportDatabase = Pick<
  Prisma.TransactionClient,
  'productionPlanBatch' | 'productionCarryover' | 'productionPlanOrder' | 'workOrder'
>;

type BatchReference = {
  batchId: string;
  planOrderId: string;
  workOrderId: string | null;
  carryover: {
    sourceWeekStartDate: Date;
    targetWeekStartDate: Date;
    originalWeekStartDate: Date;
    inclusionType: string;
    reason: string | null;
  } | null;
};

type SerializedExecutionOrder = ReturnType<typeof serializeProductionOrder>;

const COLORS = {
  navy: 'FF16324F',
  navySoft: 'FFEAF1F7',
  blueSoft: 'FFF1F7FC',
  line: 'FFD5DEE7',
  softLine: 'FFE5EBF0',
  paper: 'FFFFFFFF',
  ink: 'FF172B4D',
  muted: 'FF64748B',
  orange: 'FFE85D04',
  orangeSoft: 'FFFFF3E8',
  amberSoft: 'FFFFF7E0',
  amber: 'FF9A6700',
  greenSoft: 'FFEAF8EF',
  green: 'FF157347',
  redSoft: 'FFFFECEA',
  red: 'FFB42318',
};

const FULL_HEADERS = [
  '序号', '订单编号', '产品名称', '客户', '业务员', '批次', '排产数量', '订单数量', '生产周', '内部完成', '客户交期',
  '单件工时', '总工时(h)', '图纸', 'SOP', '资料登记', '仓库状态', '工艺状态', '流程状态', '打印状态', '异常类型', '备注',
] as const;

const FULL_COLUMN_WIDTHS = [6, 22, 30, 14, 11, 8, 11, 11, 14, 12, 12, 11, 12, 9, 9, 12, 13, 13, 18, 13, 18, 42] as const;
const SIMPLE_HEADERS = ['订单编号', '客户', '规格', '数量', '交期'] as const;
const SIMPLE_COLUMN_WIDTHS = [25, 20, 38, 13, 15] as const;

function fill(argb: string) {
  return { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } };
}

function border(argb = COLORS.line) {
  const edge = { style: 'thin' as const, color: { argb } };
  return { top: edge, right: edge, bottom: edge, left: edge };
}

function chinaDateTime(value = new Date()): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value).replaceAll('/', '-');
}

function excelDate(value: string): Date | '' {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T12:00:00+08:00`);
  return Number.isNaN(date.getTime()) ? '' : date;
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function millisecondsToHours(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed === null ? null : Number((parsed / 3_600_000).toFixed(4));
}

function unitHoursLabel(value: number | null): string {
  if (value === null) return '';
  const seconds = Math.round(value * 3_600);
  if (seconds <= 0) return '0秒';
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const tailSeconds = seconds % 60;
  return [
    hours ? `${hours}时` : '',
    minutes ? `${minutes}分` : '',
    tailSeconds ? `${tailSeconds}秒` : '',
  ].filter(Boolean).join('');
}

function dateKey(value: Date): string {
  return chinaDate(value);
}

function productionBatchScopeWhere(scope?: ProductionEntityScope): Prisma.ProductionPlanBatchWhereInput {
  const teamWhere = scope
    ? productionTeamScopeWhere(scope) as Prisma.ProductionTeamWhereInput | null
    : null;
  if (!teamWhere) return {};
  return { dailyProcessTasks: { some: { plan: { team: teamWhere } } } };
}

function printStatus(batch: ProductionPlanBatchDTO): string {
  switch (batch.travelerPrintStatus) {
    case 'printed': return '已打印';
    case 'needs_reprint': return '待重打';
    case 'partial': return '部分打印';
    case 'generated': return '待确认';
    case 'legacy_unverified': return '待核验';
    default: return '未打印';
  }
}

function warehouseStatus(batch: ProductionPlanBatchDTO): string {
  if (batch.warehouseStatus === 'completed') return '已配料';
  if (batch.warehouseStatus === 'exception') return '仓库异常';
  if (batch.warehouseStatus === 'not_created') return '未下达';
  return '待配料';
}

function processStatus(batch: ProductionPlanBatchDTO): string {
  if (batch.processStatus === 'completed') return '已完成';
  if (batch.processStatus === 'in_progress') return '生产中';
  if (batch.processStatus === 'confirmed') return '已确认';
  if (batch.processStatus === 'not_created') return '待生成';
  return '待编排';
}

function effectiveUnitMilliseconds(order: ProductionPlanOrderDTO, batch: ProductionPlanBatchDTO): number | null {
  return batch.unitMillisecondsSnapshot
    || order.effectiveUnitMilliseconds
    || order.currentUnitMilliseconds
    || order.planningUnitMilliseconds
    || null;
}

function currentBatchHours(order: ProductionPlanOrderDTO, batch: ProductionPlanBatchDTO) {
  const unitMilliseconds = effectiveUnitMilliseconds(order, batch);
  const totalMilliseconds = batch.totalMillisecondsSnapshot
    ? finiteNumber(batch.totalMillisecondsSnapshot)
    : unitMilliseconds
      ? unitMilliseconds * batch.quantity
      : null;
  return {
    unitHours: millisecondsToHours(unitMilliseconds),
    totalHours: millisecondsToHours(totalMilliseconds),
  };
}

function carryoverHours(execution: SerializedExecutionOrder | null, remainingQuantity: number | null) {
  const labor = execution?.standardLaborProgress;
  const completeStandard = Boolean(
    labor
    && labor.configuredStepCount > 0
    && (finiteNumber(labor.totalStandardMilliseconds) || 0) > 0
    && !labor.targetQuantityMissing
    && labor.missingStandardStepCount === 0
    && labor.pendingCompletionStandardCount === 0,
  );
  if (!completeStandard) return { unitHours: null, totalHours: null };
  const totalHours = millisecondsToHours(labor!.remainingStandardMilliseconds);
  return {
    totalHours,
    unitHours: totalHours !== null && remainingQuantity && remainingQuantity > 0
      ? Number((totalHours / remainingQuantity).toFixed(4))
      : null,
  };
}

function joinRemarks(values: Array<string | null | undefined>): string {
  return values.map(value => String(value || '').trim()).filter(Boolean).join('；');
}

function carryoverLabel(weeksOld: number, inclusionType: string): { kind: Exclude<WeeklyPlanCarryoverKind, null>; label: string } {
  if (inclusionType === PRODUCTION_CARRYOVER_AUTO || weeksOld <= 1) {
    return { kind: 'previous', label: '上周遗留' };
  }
  return { kind: 'older', label: `更早遗留（${weeksOld}周）` };
}

function buildExceptionType(input: {
  order: ProductionPlanOrderDTO;
  batch: ProductionPlanBatchDTO;
  totalHours: number | null;
  quantityMissing: boolean;
}): string {
  const values: string[] = [];
  if (input.quantityMissing) values.push('剩余数量待核对');
  if (input.totalHours === null) values.push('标准工时缺失');
  if (input.order.drawingFileCount === 0) values.push('图纸缺失');
  if (input.order.sopFileCount === 0) values.push('SOP缺失');
  if (input.batch.warehouseStatus === 'exception') values.push('仓库异常');
  if (input.batch.processStatus === 'not_created' || input.batch.processStatus === 'draft') values.push('工艺待确认');
  if (input.batch.travelerPrintStatus === 'needs_reprint') values.push('流转单待重打');
  return [...new Set(values)].join('；');
}

function buildExportRow(input: {
  order: ProductionPlanOrderDTO;
  batch: ProductionPlanBatchDTO;
  execution: SerializedExecutionOrder | null;
  reference: BatchReference;
}): WeeklyPlanExportRow {
  const { order, batch, execution, reference } = input;
  const completedQty = execution?.quantitySummary.completedQty ?? null;
  const remainingQty = execution?.quantitySummary.remainingQty ?? null;
  const elapsedWeeks = reference.carryover
    ? Math.max(0, Math.floor((reference.carryover.targetWeekStartDate.getTime() - reference.carryover.originalWeekStartDate.getTime()) / (7 * 86_400_000)))
    : 0;
  const carryover = reference.carryover
    ? carryoverLabel(elapsedWeeks, reference.carryover.inclusionType)
    : null;
  const scheduledQuantity = carryover ? remainingQty : batch.quantity;
  const hours = carryover
    ? carryoverHours(execution, scheduledQuantity)
    : currentBatchHours(order, batch);
  const flow = resolvePlanningFlow({
    releaseState: batch.releaseState,
    drawingReady: order.drawingFileCount > 0,
    sopReady: order.sopFileCount > 0,
    timeReady: hours.totalHours !== null,
    warehouseStatus: batch.warehouseStatus,
    processStatus: batch.processStatus,
    currentProcessName: batch.currentProcessName,
    workOrderStartedAt: batch.workOrderStartedAt,
    workOrderCompletedAt: batch.workOrderCompletedAt,
    processCompletedAt: batch.processCompletedAt,
  });
  const sourceStart = reference.carryover ? dateKey(reference.carryover.originalWeekStartDate) : null;
  const sourceEnd = reference.carryover ? dateKey(addDays(reference.carryover.originalWeekStartDate, 6)) : null;
  const carryoverRemark = carryover
    ? joinRemarks([
        `【${carryover.label}】原计划周：${sourceStart}至${sourceEnd}`,
        `原批次数量：${batch.quantity}`,
        completedQty === null ? '已完成数量：待核对' : `已完成：${completedQty}`,
        scheduledQuantity === null ? '本周剩余：待核对' : `本周剩余：${scheduledQuantity}`,
        `承接方式：${reference.carryover!.inclusionType === PRODUCTION_CARRYOVER_AUTO ? '系统自动' : '计划员手动纳入'}`,
        reference.carryover!.reason ? `纳入原因：${reference.carryover!.reason}` : null,
        scheduledQuantity === 0 && execution?.standardLaborProgress.remainingStandardMilliseconds !== '0'
          ? '数量已完成，仍有尾序待完成'
          : null,
      ])
    : null;
  const exceptionType = buildExceptionType({
    order,
    batch,
    totalHours: hours.totalHours,
    quantityMissing: scheduledQuantity === null,
  });
  return {
    planOrderId: order.id,
    batchId: batch.id,
    workOrderId: batch.workOrderId || null,
    orderNo: order.sourceOrderNo || execution?.businessCode || execution?.code || '-',
    customerName: order.customerName,
    productName: order.productName,
    salesperson: order.salesperson || '',
    specification: order.specification,
    batchNo: batch.batchNo,
    scheduledQuantity,
    originalBatchQuantity: batch.quantity,
    completedQuantity: completedQty,
    orderQuantity: order.orderQuantity,
    weekLabel: carryover?.label || '本周',
    plannedCompletionDate: batch.plannedCompletionDate,
    customerDueDate: batch.productionControl ? (batch.productionControl.customerDueDate || '') : order.customerDueDate,
    unitHours: hours.unitHours,
    totalHours: hours.totalHours,
    drawingStatus: order.drawingFileCount ? `图纸 ${order.drawingFileCount}` : '图纸缺失',
    sopStatus: order.sopFileCount ? `SOP ${order.sopFileCount}` : 'SOP缺失',
    documentRegistrationStatus: planningSopStageLabels[planningSopStage(order.sopStage)],
    warehouseStatus: warehouseStatus(batch),
    processStatus: processStatus(batch),
    flowStatus: flow.label,
    printStatus: printStatus(batch),
    exceptionType,
    remark: joinRemarks([carryoverRemark, order.sopRemark, order.remark,
      batch.productionControl?.note?.text ? `当前问题：${batch.productionControl.note.text}` : null,
      batch.productionControl?.pausedAt ? `已暂停：${batch.productionControl.pause?.reason || ''}` : null,
      batch.productionControl?.estimatedCompletionDate ? `内部预计完成：${batch.productionControl.estimatedCompletionDate}` : null,
      batch.productionControl?.adjustmentCount ? `原客户承诺：${batch.productionControl.deliveryBaselineDate || '待确认'}；原计划：${batch.productionControl.planBaselineDate || '待确认'}` : null,
    ]),
    carryoverKind: carryover?.kind || null,
    carryoverWeeksOld: elapsedWeeks,
    carryoverReason: reference.carryover?.reason || null,
    inclusionType: reference.carryover?.inclusionType || null,
  };
}

export function summarizeWeeklyPlanRows(rows: readonly WeeklyPlanExportRow[]): WeeklyPlanExportSummary {
  return {
    batchCount: rows.length,
    orderCount: new Set(rows.map(row => row.planOrderId)).size,
    quantity: rows.reduce((sum, row) => sum + (row.scheduledQuantity ?? 0), 0),
    totalHours: Number(rows.reduce((sum, row) => sum + (row.totalHours ?? 0), 0).toFixed(4)),
    quantityMissingCount: rows.filter(row => row.scheduledQuantity === null).length,
    hoursMissingCount: rows.filter(row => row.totalHours === null).length,
  };
}

function mergeSummaries(first: WeeklyPlanExportSummary, second: WeeklyPlanExportSummary): WeeklyPlanExportSummary {
  return {
    batchCount: first.batchCount + second.batchCount,
    orderCount: 0,
    quantity: first.quantity + second.quantity,
    totalHours: Number((first.totalHours + second.totalHours).toFixed(4)),
    quantityMissingCount: first.quantityMissingCount + second.quantityMissingCount,
    hoursMissingCount: first.hoursMissingCount + second.hoursMissingCount,
  };
}

export async function loadWeeklyPlanExportData(input: {
  now?: Date;
  productionScope?: ProductionEntityScope;
  db?: WeeklyPlanExportDatabase;
} = {}): Promise<WeeklyPlanExportDataset> {
  const db = input.db || prisma;
  const week = naturalProductionWeek(input.now || new Date());
  const targetWindow = productionCarryoverDayWindow(week.start);
  const [nativeBatches, carryoverLinks] = await Promise.all([
    db.productionPlanBatch.findMany({
      where: {
        deletedAt: null,
        releaseState: { not: 'archived' },
        weekStartDate: targetWindow,
        planOrder: { deletedAt: null },
        ...productionBatchScopeWhere(input.productionScope),
      },
      select: { id: true, planOrderId: true, workOrderId: true },
      orderBy: [{ plannedCompletionDate: 'asc' }, { batchNo: 'asc' }],
      take: WEEKLY_PLAN_EXPORT_MAX_BATCHES + 1,
    }),
    db.productionCarryover.findMany({
      where: activeProductionCarryoverLinkWhere(week.start, input.productionScope),
      select: {
        productionPlanBatchId: true,
        sourceWeekStartDate: true,
        targetWeekStartDate: true,
        inclusionType: true,
        reason: true,
        productionPlanBatch: {
          select: { planOrderId: true, workOrderId: true, weekStartDate: true },
        },
      },
      orderBy: [{ sourceWeekStartDate: 'desc' }, { createdAt: 'asc' }],
      take: WEEKLY_PLAN_EXPORT_MAX_BATCHES + 1,
    }),
  ]);
  const references = new Map<string, BatchReference>();
  for (const batch of nativeBatches) {
    references.set(batch.id, {
      batchId: batch.id,
      planOrderId: batch.planOrderId,
      workOrderId: batch.workOrderId,
      carryover: null,
    });
  }
  for (const link of carryoverLinks) {
    if (references.has(link.productionPlanBatchId)) continue;
    references.set(link.productionPlanBatchId, {
      batchId: link.productionPlanBatchId,
      planOrderId: link.productionPlanBatch.planOrderId,
      workOrderId: link.productionPlanBatch.workOrderId,
      carryover: {
        sourceWeekStartDate: link.sourceWeekStartDate,
        targetWeekStartDate: link.targetWeekStartDate,
        originalWeekStartDate: link.productionPlanBatch.weekStartDate,
        inclusionType: link.inclusionType,
        reason: link.reason,
      },
    });
  }
  if (references.size > WEEKLY_PLAN_EXPORT_MAX_BATCHES) {
    throw new WeeklyPlanExportError(
      `本周执行批次超过 ${WEEKLY_PLAN_EXPORT_MAX_BATCHES} 条，请缩小数据范围后再导出`,
      'WEEKLY_PLAN_EXPORT_LIMIT',
      413,
    );
  }
  const selected = [...references.values()];
  const planOrderIds = [...new Set(selected.map(item => item.planOrderId))];
  const workOrderIds = [...new Set(selected.map(item => item.workOrderId).filter((value): value is string => Boolean(value)))];
  const [planOrderRecords, workOrderRecords] = await Promise.all([
    planOrderIds.length
      ? db.productionPlanOrder.findMany({
          where: { id: { in: planOrderIds }, deletedAt: null },
          include: productionPlanOrderInclude,
        })
      : [],
    workOrderIds.length
      ? db.workOrder.findMany({
          where: { id: { in: workOrderIds }, deletedAt: null },
          include: productionExecutionInclude,
        })
      : [],
  ]);
  const planBatchById = new Map<string, { order: ProductionPlanOrderDTO; batch: ProductionPlanBatchDTO }>();
  for (const record of planOrderRecords) {
    const order = serializeProductionPlanOrder(record);
    for (const batch of order.batches) planBatchById.set(batch.id, { order, batch });
  }
  const executionById = new Map(workOrderRecords.map(record => [record.id, serializeProductionOrder(record)] as const));
  const rows = selected.map(reference => {
    const planning = planBatchById.get(reference.batchId);
    if (!planning) {
      throw new WeeklyPlanExportError('周计划批次数据已变化，请刷新后重试', 'WEEKLY_PLAN_EXPORT_STALE', 409);
    }
    return buildExportRow({
      ...planning,
      reference,
      execution: reference.workOrderId ? executionById.get(reference.workOrderId) || null : null,
    });
  }).sort((left, right) => (
    Number(Boolean(left.carryoverKind)) - Number(Boolean(right.carryoverKind))
    || left.customerDueDate.localeCompare(right.customerDueDate)
    || left.customerName.localeCompare(right.customerName, 'zh-CN')
    || left.orderNo.localeCompare(right.orderNo, 'zh-CN')
    || left.batchNo - right.batchNo
  ));
  const currentRows = rows.filter(row => row.carryoverKind === null);
  const previousCarryoverRows = rows.filter(row => row.carryoverKind === 'previous');
  const olderCarryoverRows = rows.filter(row => row.carryoverKind === 'older');
  const current = summarizeWeeklyPlanRows(currentRows);
  const previousCarryover = summarizeWeeklyPlanRows(previousCarryoverRows);
  const olderCarryover = summarizeWeeklyPlanRows(olderCarryoverRows);
  const carryover = summarizeWeeklyPlanRows([...previousCarryoverRows, ...olderCarryoverRows]);
  const execution = summarizeWeeklyPlanRows(rows);
  return {
    weekStartDate: dateKey(week.start),
    weekEndDate: dateKey(week.end),
    currentRows,
    previousCarryoverRows,
    olderCarryoverRows,
    rows,
    summary: {
      current,
      previousCarryover,
      olderCarryover,
      carryover: { ...mergeSummaries(previousCarryover, olderCarryover), orderCount: carryover.orderCount },
      execution,
    },
  };
}

export function parseWeeklyPlanExportVersion(value: string | null): WeeklyPlanExportVersion {
  if (value === 'full' || value === 'orders') return value;
  throw new WeeklyPlanExportError('导出版本不正确', 'WEEKLY_PLAN_EXPORT_VERSION_INVALID');
}

export function parseWeeklyPlanExportRange(value: string | null): WeeklyPlanExportRange {
  if (value === 'execution' || value === 'current') return value;
  throw new WeeklyPlanExportError('导出范围不正确', 'WEEKLY_PLAN_EXPORT_RANGE_INVALID');
}

export function weeklyPlanRowsForRange(dataset: WeeklyPlanExportDataset, range: WeeklyPlanExportRange) {
  return range === 'current' ? dataset.currentRows : dataset.rows;
}

export function weeklyPlanExportFileName(
  dataset: Pick<WeeklyPlanExportDataset, 'weekStartDate' | 'weekEndDate'>,
  version: WeeklyPlanExportVersion,
  range: WeeklyPlanExportRange,
) {
  return `本周生产计划_${dataset.weekStartDate}至${dataset.weekEndDate}_${version === 'full' ? '完整版' : '订单简版'}_${range === 'execution' ? '含遗留' : '仅本周'}.xlsx`;
}

function configureWorkbook(workbook: ExcelJS.Workbook) {
  workbook.creator = '杭连电子协同平台';
  workbook.lastModifiedBy = '杭连电子协同平台';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
}

function styleTitle(sheet: Worksheet, lastColumn: number, title: string) {
  sheet.mergeCells(1, 1, 2, lastColumn);
  const cell = sheet.getCell(1, 1);
  cell.value = title;
  cell.fill = fill(COLORS.navy);
  cell.font = { name: 'Microsoft YaHei', size: 22, bold: true, color: { argb: COLORS.paper } };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  cell.border = border(COLORS.navy);
  sheet.getRow(1).height = 30;
  sheet.getRow(2).height = 22;
}

function styleMergedInfo(sheet: Worksheet, row: number, lastColumn: number, value: string, tone: 'blue' | 'orange') {
  sheet.mergeCells(row, 1, row, lastColumn);
  const cell = sheet.getCell(row, 1);
  cell.value = value;
  cell.fill = fill(tone === 'orange' ? COLORS.orangeSoft : COLORS.navySoft);
  cell.font = {
    name: 'Microsoft YaHei',
    size: tone === 'orange' ? 9.5 : 10.5,
    bold: tone === 'blue',
    color: { argb: tone === 'orange' ? COLORS.orange : COLORS.ink },
  };
  cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1, wrapText: true };
  cell.border = border(tone === 'orange' ? 'FFF2C7A8' : COLORS.line);
  sheet.getRow(row).height = row === 4 ? 28 : 24;
}

function styleHeaderRow(sheet: Worksheet, headers: readonly string[], rowNumber = 6) {
  headers.forEach((header, index) => {
    const cell = sheet.getCell(rowNumber, index + 1);
    cell.value = header;
    cell.fill = fill(COLORS.navy);
    cell.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: COLORS.paper } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = border('FF294A68');
  });
  sheet.getRow(rowNumber).height = 28;
}

function scopeNote(dataset: WeeklyPlanExportDataset, range: WeeklyPlanExportRange): string {
  const carryover = dataset.summary.carryover;
  if (range === 'current') {
    const unknown = [
      carryover.quantityMissingCount ? `${carryover.quantityMissingCount} 批数量待核对` : '',
      carryover.hoursMissingCount ? `${carryover.hoursMissingCount} 批工时待补` : '',
    ].filter(Boolean).join('、');
    return `导出范围：仅本周新计划；未包含有效遗留 ${carryover.batchCount} 批、${carryover.quantity.toLocaleString('zh-CN')} 件、已知剩余标准工时 ${carryover.totalHours.toFixed(2)} 小时${unknown ? `；另有${unknown}` : ''}。`;
  }
  return `导出范围：本周执行清单（含有效遗留）；其中上周遗留 ${dataset.summary.previousCarryover.batchCount} 批，更早遗留 ${dataset.summary.olderCarryover.batchCount} 批。`;
}

function summaryLine(dataset: WeeklyPlanExportDataset, rows: readonly WeeklyPlanExportRow[], range: WeeklyPlanExportRange): string {
  const summary = summarizeWeeklyPlanRows(rows);
  const missing = [
    summary.quantityMissingCount ? `${summary.quantityMissingCount} 批数量待核对` : '',
    summary.hoursMissingCount ? `${summary.hoursMissingCount} 批工时待补` : '',
  ].filter(Boolean).join('；');
  return `计划期间：${dataset.weekStartDate} 至 ${dataset.weekEndDate}    批次：${summary.batchCount}    排产数量：${summary.quantity.toLocaleString('zh-CN')}    已知总工时：${summary.totalHours.toFixed(2)} h    范围：${range === 'execution' ? '含有效遗留' : '仅本周'}${missing ? `    ${missing}` : ''}`;
}

function styleBodyCell(cell: Cell, options: { numeric?: boolean; date?: boolean; carryover?: boolean; rowIndex: number }) {
  cell.font = { name: 'Microsoft YaHei', size: 9.5, color: { argb: COLORS.ink } };
  cell.fill = fill(options.carryover ? COLORS.amberSoft : options.rowIndex % 2 === 0 ? COLORS.blueSoft : COLORS.paper);
  cell.border = border(COLORS.softLine);
  cell.alignment = {
    horizontal: options.numeric ? 'right' : options.date ? 'center' : 'left',
    vertical: 'middle',
    wrapText: true,
  };
  if (options.numeric) cell.numFmt = '#,##0.00';
  if (options.date) cell.numFmt = 'yyyy-mm-dd';
}

function setFormula(cell: Cell, formula: string, result: number, numFmt: string) {
  cell.value = { formula, result };
  cell.numFmt = numFmt;
  cell.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: COLORS.paper } };
  cell.fill = fill(COLORS.navy);
  cell.alignment = { horizontal: 'right', vertical: 'middle' };
  cell.border = border(COLORS.navy);
}

function populateFullWorkbook(
  workbook: ExcelJS.Workbook,
  dataset: WeeklyPlanExportDataset,
  range: WeeklyPlanExportRange,
  generatedAt: string,
) {
  const rows = weeklyPlanRowsForRange(dataset, range);
  const summary = summarizeWeeklyPlanRows(rows);
  const sheet = workbook.addWorksheet('本周计划打印版', {
    properties: { defaultRowHeight: 20 },
    views: [{ state: 'frozen', ySplit: 6, topLeftCell: 'A7', activeCell: 'A7', showGridLines: false, zoomScale: 75 }],
  });
  sheet.pageSetup = {
    // ECMA-376 paper-size code 8 is A3. ExcelJS writes it correctly although
    // the bundled type declaration only enumerates a subset of paper sizes.
    paperSize: 8 as ExcelJS.PaperSize,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.2, right: 0.2, top: 0.3, bottom: 0.3, header: 0.15, footer: 0.15 },
  };
  FULL_COLUMN_WIDTHS.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  styleTitle(sheet, FULL_HEADERS.length, '本周生产计划清单');
  styleMergedInfo(sheet, 3, FULL_HEADERS.length, summaryLine(dataset, rows, range), 'blue');
  styleMergedInfo(sheet, 4, FULL_HEADERS.length, `${scopeNote(dataset, range)}    生成时间：${generatedAt}`, 'orange');
  sheet.getRow(5).height = 7;
  styleHeaderRow(sheet, FULL_HEADERS);
  const dataStartRow = 7;
  rows.forEach((row, rowIndex) => {
    const excelRow = dataStartRow + rowIndex;
    const values: Array<string | number | Date | null> = [
      rowIndex + 1,
      row.orderNo,
      row.productName,
      row.customerName,
      row.salesperson,
      `第${row.batchNo}批`,
      row.scheduledQuantity,
      row.orderQuantity,
      row.weekLabel,
      excelDate(row.plannedCompletionDate),
      excelDate(row.customerDueDate),
      unitHoursLabel(row.unitHours),
      row.totalHours,
      row.drawingStatus,
      row.sopStatus,
      row.documentRegistrationStatus,
      row.warehouseStatus,
      row.processStatus,
      row.flowStatus,
      row.printStatus,
      row.exceptionType,
      row.remark,
    ];
    values.forEach((value, columnIndex) => {
      const cell = sheet.getCell(excelRow, columnIndex + 1);
      cell.value = value === null || value === '' ? null : value;
      styleBodyCell(cell, {
        rowIndex,
        carryover: Boolean(row.carryoverKind),
        numeric: [0, 6, 7, 12].includes(columnIndex),
        date: columnIndex === 9 || columnIndex === 10,
      });
      if (columnIndex === 0 || columnIndex === 5 || columnIndex === 8) cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    sheet.getCell(excelRow, 1).numFmt = '0';
    sheet.getCell(excelRow, 7).numFmt = '#,##0';
    sheet.getCell(excelRow, 8).numFmt = '#,##0';
    sheet.getCell(excelRow, 13).numFmt = '0.00" h"';
    if (row.carryoverKind) {
      sheet.getCell(excelRow, 9).font = { name: 'Microsoft YaHei', size: 9.5, bold: true, color: { argb: COLORS.amber } };
    }
    if (row.exceptionType) {
      sheet.getCell(excelRow, 21).fill = fill(COLORS.redSoft);
      sheet.getCell(excelRow, 21).font = { name: 'Microsoft YaHei', size: 9.5, bold: true, color: { argb: COLORS.red } };
    }
    sheet.getRow(excelRow).height = row.remark.length > 60 ? 42 : 30;
  });
  if (!rows.length) {
    sheet.mergeCells(dataStartRow, 1, dataStartRow, FULL_HEADERS.length);
    const empty = sheet.getCell(dataStartRow, 1);
    empty.value = '当前导出范围暂无计划数据';
    empty.font = { name: 'Microsoft YaHei', size: 11, italic: true, color: { argb: COLORS.muted } };
    empty.alignment = { horizontal: 'center', vertical: 'middle' };
    empty.fill = fill(COLORS.blueSoft);
    empty.border = border(COLORS.softLine);
    sheet.getRow(dataStartRow).height = 36;
  }
  const dataEndRow = dataStartRow + Math.max(rows.length, 1) - 1;
  const totalRow = dataEndRow + 1;
  sheet.mergeCells(totalRow, 1, totalRow, 6);
  const totalLabel = sheet.getCell(totalRow, 1);
  totalLabel.value = '合计';
  totalLabel.fill = fill(COLORS.navy);
  totalLabel.font = { name: 'Microsoft YaHei', size: 10.5, bold: true, color: { argb: COLORS.paper } };
  totalLabel.alignment = { horizontal: 'center', vertical: 'middle' };
  totalLabel.border = border(COLORS.navy);
  setFormula(sheet.getCell(totalRow, 7), `COUNTA(B${dataStartRow}:B${dataEndRow})`, summary.batchCount, '0" 批"');
  setFormula(sheet.getCell(totalRow, 8), `SUM(G${dataStartRow}:G${dataEndRow})`, summary.quantity, '#,##0" 件"');
  sheet.mergeCells(totalRow, 9, totalRow, 12);
  const hoursLabel = sheet.getCell(totalRow, 9);
  hoursLabel.value = '已知总工时';
  hoursLabel.fill = fill(COLORS.navy);
  hoursLabel.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: COLORS.paper } };
  hoursLabel.alignment = { horizontal: 'right', vertical: 'middle' };
  hoursLabel.border = border(COLORS.navy);
  setFormula(sheet.getCell(totalRow, 13), `SUM(M${dataStartRow}:M${dataEndRow})`, summary.totalHours, '#,##0.00" h"');
  sheet.mergeCells(totalRow, 14, totalRow, 22);
  const totalNote = sheet.getCell(totalRow, 14);
  totalNote.value = summary.hoursMissingCount || summary.quantityMissingCount
    ? `另有 ${summary.quantityMissingCount} 批数量待核对、${summary.hoursMissingCount} 批工时待补，未按 0 计入。`
    : '数量与工时按本次导出数据范围汇总。';
  totalNote.fill = fill(COLORS.navy);
  totalNote.font = { name: 'Microsoft YaHei', size: 9, color: { argb: COLORS.paper } };
  totalNote.alignment = { horizontal: 'left', vertical: 'middle', indent: 1, wrapText: true };
  totalNote.border = border(COLORS.navy);
  sheet.getRow(totalRow).height = 27;
  sheet.autoFilter = { from: { row: 6, column: 1 }, to: { row: dataEndRow, column: FULL_HEADERS.length } };
  sheet.pageSetup.printArea = `A1:V${totalRow}`;
  sheet.pageSetup.printTitlesRow = '6:6';
  sheet.headerFooter.oddFooter = '&L杭连电子协同平台&C第 &P / &N 页&R本周生产计划';
  return sheet;
}

type SimpleOrderRow = {
  planOrderId: string;
  orderNo: string;
  customerName: string;
  specification: string;
  quantity: number | null;
  customerDueDate: string;
  carryover: boolean;
};

export function buildWeeklyPlanSimpleRows(rows: readonly WeeklyPlanExportRow[]): SimpleOrderRow[] {
  const result = new Map<string, SimpleOrderRow & { quantityComplete: boolean }>();
  for (const row of rows) {
    const current = result.get(row.planOrderId);
    if (!current) {
      result.set(row.planOrderId, {
        planOrderId: row.planOrderId,
        orderNo: row.orderNo,
        customerName: row.customerName,
        specification: row.specification,
        quantity: row.scheduledQuantity,
        quantityComplete: row.scheduledQuantity !== null,
        customerDueDate: row.customerDueDate,
        carryover: Boolean(row.carryoverKind),
      });
      continue;
    }
    current.carryover ||= Boolean(row.carryoverKind);
    current.quantityComplete &&= row.scheduledQuantity !== null;
    current.quantity = current.quantityComplete
      ? (current.quantity || 0) + (row.scheduledQuantity || 0)
      : null;
  }
  return [...result.values()]
    .map(({ quantityComplete: _quantityComplete, ...row }) => row)
    .sort((left, right) => (
      left.customerDueDate.localeCompare(right.customerDueDate)
      || left.customerName.localeCompare(right.customerName, 'zh-CN')
      || left.orderNo.localeCompare(right.orderNo, 'zh-CN')
    ));
}

function populateSimpleWorkbook(
  workbook: ExcelJS.Workbook,
  dataset: WeeklyPlanExportDataset,
  range: WeeklyPlanExportRange,
  generatedAt: string,
) {
  const batchRows = weeklyPlanRowsForRange(dataset, range);
  const rows = buildWeeklyPlanSimpleRows(batchRows);
  const summary = summarizeWeeklyPlanRows(batchRows);
  const sheet = workbook.addWorksheet('本周计划订单简版', {
    properties: { defaultRowHeight: 22 },
    views: [{ state: 'frozen', ySplit: 6, topLeftCell: 'A7', activeCell: 'A7', showGridLines: false, zoomScale: 90 }],
  });
  sheet.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.3, right: 0.3, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 },
  };
  SIMPLE_COLUMN_WIDTHS.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  styleTitle(sheet, SIMPLE_HEADERS.length, '本周生产计划订单清单');
  styleMergedInfo(
    sheet,
    3,
    SIMPLE_HEADERS.length,
    `计划期间：${dataset.weekStartDate} 至 ${dataset.weekEndDate}    订单：${rows.length}    数量：${summary.quantity.toLocaleString('zh-CN')}    范围：${range === 'execution' ? '含有效遗留' : '仅本周'}`,
    'blue',
  );
  styleMergedInfo(sheet, 4, SIMPLE_HEADERS.length, `${scopeNote(dataset, range)}    生成时间：${generatedAt}`, 'orange');
  sheet.getRow(5).height = 7;
  styleHeaderRow(sheet, SIMPLE_HEADERS);
  const dataStartRow = 7;
  rows.forEach((row, rowIndex) => {
    const excelRow = dataStartRow + rowIndex;
    const values: Array<string | number | Date> = [
      row.orderNo,
      row.customerName,
      row.specification,
      row.quantity ?? '',
      excelDate(row.customerDueDate),
    ];
    values.forEach((value, columnIndex) => {
      const cell = sheet.getCell(excelRow, columnIndex + 1);
      cell.value = value === '' ? null : value;
      styleBodyCell(cell, {
        rowIndex,
        carryover: row.carryover,
        numeric: columnIndex === 3,
        date: columnIndex === 4,
      });
    });
    sheet.getCell(excelRow, 4).numFmt = '#,##0';
    sheet.getRow(excelRow).height = 28;
  });
  if (!rows.length) {
    sheet.mergeCells(dataStartRow, 1, dataStartRow, SIMPLE_HEADERS.length);
    const empty = sheet.getCell(dataStartRow, 1);
    empty.value = '当前导出范围暂无计划订单';
    empty.font = { name: 'Microsoft YaHei', size: 11, italic: true, color: { argb: COLORS.muted } };
    empty.alignment = { horizontal: 'center', vertical: 'middle' };
    empty.fill = fill(COLORS.blueSoft);
    empty.border = border(COLORS.softLine);
    sheet.getRow(dataStartRow).height = 36;
  }
  const dataEndRow = dataStartRow + Math.max(rows.length, 1) - 1;
  const totalRow = dataEndRow + 1;
  sheet.mergeCells(totalRow, 1, totalRow, 3);
  const label = sheet.getCell(totalRow, 1);
  label.value = `合计 ${rows.length} 个订单`;
  label.fill = fill(COLORS.navy);
  label.font = { name: 'Microsoft YaHei', size: 10.5, bold: true, color: { argb: COLORS.paper } };
  label.alignment = { horizontal: 'center', vertical: 'middle' };
  label.border = border(COLORS.navy);
  setFormula(sheet.getCell(totalRow, 4), `SUM(D${dataStartRow}:D${dataEndRow})`, summary.quantity, '#,##0" 件"');
  const note = sheet.getCell(totalRow, 5);
  note.value = summary.quantityMissingCount ? `${summary.quantityMissingCount} 批数量待核对` : '数量合计';
  note.fill = fill(COLORS.navy);
  note.font = { name: 'Microsoft YaHei', size: 9, color: { argb: COLORS.paper } };
  note.alignment = { horizontal: 'center', vertical: 'middle' };
  note.border = border(COLORS.navy);
  sheet.getRow(totalRow).height = 28;
  sheet.autoFilter = { from: { row: 6, column: 1 }, to: { row: dataEndRow, column: SIMPLE_HEADERS.length } };
  sheet.pageSetup.printArea = `A1:E${totalRow}`;
  sheet.pageSetup.printTitlesRow = '6:6';
  sheet.headerFooter.oddFooter = '&L杭连电子协同平台&C第 &P / &N 页&R本周计划订单简版';
  return sheet;
}

export function createWeeklyPlanExportWorkbook(input: {
  dataset: WeeklyPlanExportDataset;
  version: WeeklyPlanExportVersion;
  range: WeeklyPlanExportRange;
  generatedAt?: string;
}) {
  const workbook = new ExcelJS.Workbook();
  configureWorkbook(workbook);
  const generatedAt = input.generatedAt || chinaDateTime();
  if (input.version === 'orders') populateSimpleWorkbook(workbook, input.dataset, input.range, generatedAt);
  else populateFullWorkbook(workbook, input.dataset, input.range, generatedAt);
  return workbook;
}
