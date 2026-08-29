import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {
  buildWeeklyPlanSimpleRows,
  createWeeklyPlanExportWorkbook,
  parseWeeklyPlanExportMode,
  parseWeeklyPlanExportRange,
  parseWeeklyPlanExportVersion,
  summarizeWeeklyPlanRows,
  weeklyPlanExportFileName,
  type WeeklyPlanExportDataset,
  type WeeklyPlanExportRow,
} from '@/lib/weekly-plan-export';

function row(overrides: Partial<WeeklyPlanExportRow> = {}): WeeklyPlanExportRow {
  return {
    planOrderId: 'plan-1',
    batchId: 'batch-1',
    workOrderId: null,
    orderNo: 'SO-1001',
    customerName: '测试客户',
    productName: '测试产品',
    salesperson: '业务员甲',
    specification: 'A35DA2-TEST',
    batchNo: 1,
    scheduledQuantity: 10,
    originalBatchQuantity: 10,
    completedQuantity: null,
    orderQuantity: 30,
    weekLabel: '本周',
    plannedCompletionDate: '2026-08-28',
    customerDueDate: '2026-08-30',
    unitHours: 0.25,
    totalHours: 2.5,
    drawingStatus: '图纸 1',
    sopStatus: 'SOP 1',
    documentRegistrationStatus: '标准',
    warehouseStatus: '已配料',
    processStatus: '已确认',
    flowStatus: '本周待执行',
    printStatus: '已打印',
    exceptionType: '',
    remark: '本周计划备注',
    carryoverKind: null,
    carryoverWeeksOld: 0,
    carryoverReason: null,
    inclusionType: null,
    ...overrides,
  };
}

function dataset(): WeeklyPlanExportDataset {
  const currentRows = [
    row(),
    row({ batchId: 'batch-2', batchNo: 2, scheduledQuantity: 5, originalBatchQuantity: 5, totalHours: 1.25 }),
  ];
  const previousCarryoverRows = [row({
    planOrderId: 'plan-2',
    batchId: 'batch-3',
    workOrderId: 'wo-2',
    orderNo: 'SO-1002',
    customerName: '遗留客户',
    specification: 'B35DA2-LEGACY',
    scheduledQuantity: 4,
    originalBatchQuantity: 10,
    completedQuantity: 6,
    orderQuantity: 10,
    weekLabel: '上周遗留',
    unitHours: 0.5,
    totalHours: 2,
    carryoverKind: 'previous',
    carryoverWeeksOld: 1,
    inclusionType: 'AUTO_PREVIOUS_WEEK',
    remark: '【上周遗留】原批次数量：10；已完成：6；本周剩余：4',
  })];
  const olderCarryoverRows = [row({
    planOrderId: 'plan-3',
    batchId: 'batch-4',
    workOrderId: 'wo-3',
    orderNo: 'SO-1003',
    customerName: '更早客户',
    specification: 'C35DA2-OLDER',
    scheduledQuantity: 2,
    originalBatchQuantity: 8,
    completedQuantity: 6,
    orderQuantity: 8,
    weekLabel: '更早遗留（3周）',
    totalHours: null,
    unitHours: null,
    carryoverKind: 'older',
    carryoverWeeksOld: 3,
    inclusionType: 'MANUAL_OLDER_WEEK',
    carryoverReason: '原料延期',
    exceptionType: '标准工时缺失',
    remark: '【更早遗留·3周】本周剩余：2；纳入原因：原料延期',
  })];
  const rows = [...currentRows, ...previousCarryoverRows, ...olderCarryoverRows];
  return {
    weekStartDate: '2026-08-24',
    weekEndDate: '2026-08-30',
    currentRows,
    previousCarryoverRows,
    olderCarryoverRows,
    rows,
    summary: {
      current: summarizeWeeklyPlanRows(currentRows),
      previousCarryover: summarizeWeeklyPlanRows(previousCarryoverRows),
      olderCarryover: summarizeWeeklyPlanRows(olderCarryoverRows),
      carryover: summarizeWeeklyPlanRows([...previousCarryoverRows, ...olderCarryoverRows]),
      execution: summarizeWeeklyPlanRows(rows),
    },
  };
}

test('full weekly-plan workbook keeps the 22-column template and uses carryover remaining quantities', async () => {
  const workbook = createWeeklyPlanExportWorkbook({
    dataset: dataset(),
    version: 'full',
    range: 'execution',
    generatedAt: '2026-08-24 12:00',
  });
  const sheet = workbook.getWorksheet('生产计划打印版')!;
  assert.equal(sheet.columnCount, 22);
  assert.equal(sheet.getCell('A1').value, '生产执行计划清单');
  assert.equal(sheet.getCell('A6').value, '序号');
  assert.equal(sheet.getCell('V6').value, '备注');
  assert.equal(sheet.getCell('G9').value, 4);
  assert.equal(sheet.getCell('G9').value === 10, false, 'carryover must not reuse the original full batch quantity');
  assert.equal(sheet.getCell('L9').value, '30分');
  assert.equal(sheet.getCell('A7').numFmt, '0');
  assert.equal(sheet.getCell('U7').value, null);
  assert.equal(sheet.getCell('V7').value, '本周计划备注');
  assert.match(String(sheet.getCell('V9').value), /本周剩余：4/);
  assert.equal(sheet.getCell('I9').value, '上周遗留');
  assert.equal(sheet.getCell('U10').value, '标准工时缺失');
  assert.equal((sheet.getCell('G11').value as ExcelJS.CellFormulaValue).formula, 'COUNTA(B7:B10)');
  assert.equal((sheet.getCell('H11').value as ExcelJS.CellFormulaValue).formula, 'SUM(G7:G10)');
  assert.equal((sheet.getCell('M11').value as ExcelJS.CellFormulaValue).formula, 'SUM(M7:M10)');
  assert.equal(sheet.pageSetup.paperSize, 8);
  assert.equal(sheet.pageSetup.orientation, 'landscape');
  assert.equal(sheet.pageSetup.fitToWidth, 1);
  assert.equal(sheet.pageSetup.printTitlesRow, '6:6');
  assert.equal(sheet.views[0]?.state, 'frozen');
  const autoFilter = sheet.autoFilter;
  assert.equal(
    typeof autoFilter === 'object' && typeof autoFilter.from === 'object' ? autoFilter.from.row : null,
    6,
  );

  const bytes = await workbook.xlsx.writeBuffer({ useStyles: true, useSharedStrings: true });
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(bytes);
  const reopenedSheet = reopened.getWorksheet('生产计划打印版')!;
  assert.equal(reopenedSheet.getCell('G9').value, 4);
  assert.ok(reopenedSheet.getCell('K9').value instanceof Date);
  assert.equal(reopenedSheet.getCell('L9').value, '30分');
  assert.equal(reopenedSheet.getCell('M9').numFmt, '0.00" h"');
});

test('order-only workbook has exactly five fields and aggregates batches by plan order', async () => {
  const source = dataset();
  const simpleRows = buildWeeklyPlanSimpleRows(source.rows);
  assert.equal(simpleRows.length, 3);
  assert.equal(simpleRows.find(item => item.planOrderId === 'plan-1')?.quantity, 15);
  assert.equal(simpleRows.find(item => item.planOrderId === 'plan-2')?.quantity, 4);

  const workbook = createWeeklyPlanExportWorkbook({
    dataset: source,
    version: 'orders',
    range: 'execution',
    generatedAt: '2026-08-24 12:00',
  });
  const sheet = workbook.getWorksheet('生产计划订单简版')!;
  assert.deepEqual(
    ['A6', 'B6', 'C6', 'D6', 'E6'].map(address => sheet.getCell(address).value),
    ['订单编号', '客户', '规格', '数量', '交期'],
  );
  assert.equal(sheet.columnCount, 5);
  assert.equal(sheet.getCell('D7').value, 15);
  assert.equal((sheet.getCell('D10').value as ExcelJS.CellFormulaValue).formula, 'SUM(D7:D9)');
  assert.equal(sheet.pageSetup.paperSize, 9);
  assert.equal(sheet.pageSetup.orientation, 'landscape');
  assert.equal(sheet.pageSetup.printArea, 'A1:E10');
});

test('current-only export excludes carryover rows and records the exclusion in the workbook', () => {
  const workbook = createWeeklyPlanExportWorkbook({
    dataset: dataset(),
    version: 'orders',
    range: 'current',
    generatedAt: '2026-08-24 12:00',
  });
  const sheet = workbook.getWorksheet('生产计划订单简版')!;
  assert.equal(sheet.getCell('D7').value, 15);
  assert.match(String(sheet.getCell('A4').value), /未包含有效遗留 2 批、6 件/);
  assert.equal((sheet.getCell('D8').value as ExcelJS.CellFormulaValue).result, 15);
});

test('current-only export says when excluded carryover labor is unknown instead of treating it as zero', () => {
  const source = dataset();
  const unknownCarryover = source.previousCarryoverRows[0];
  unknownCarryover.totalHours = null;
  unknownCarryover.unitHours = null;
  source.summary.previousCarryover = summarizeWeeklyPlanRows(source.previousCarryoverRows);
  source.summary.carryover = summarizeWeeklyPlanRows([...source.previousCarryoverRows, ...source.olderCarryoverRows]);
  source.summary.execution = summarizeWeeklyPlanRows(source.rows);
  const workbook = createWeeklyPlanExportWorkbook({
    dataset: source,
    version: 'orders',
    range: 'current',
    generatedAt: '2026-08-24 12:00',
  });
  assert.match(String(workbook.getWorksheet('生产计划订单简版')!.getCell('A4').value), /另有2 批工时待补/);
});

test('weekly-plan export request values fail closed', () => {
  assert.equal(parseWeeklyPlanExportVersion('full'), 'full');
  assert.equal(parseWeeklyPlanExportVersion('orders'), 'orders');
  assert.equal(parseWeeklyPlanExportRange('execution'), 'execution');
  assert.equal(parseWeeklyPlanExportRange('current'), 'current');
  assert.equal(parseWeeklyPlanExportMode('week_execution'), 'week_execution');
  assert.equal(parseWeeklyPlanExportMode('schedule_range'), 'schedule_range');
  assert.throws(() => parseWeeklyPlanExportVersion('csv'), /导出版本不正确/);
  assert.throws(() => parseWeeklyPlanExportRange('history'), /导出范围不正确/);
  assert.throws(() => parseWeeklyPlanExportMode('history'), /导出模式不正确/);
});

test('date-range workbook uses neutral titles and includes every batch only once', () => {
  const source = dataset();
  source.mode = 'schedule_range';
  source.weekStartDate = '2026-08-31';
  source.weekEndDate = '2026-09-30';
  source.previousCarryoverRows = [];
  source.olderCarryoverRows = [];
  source.rows = source.currentRows;
  source.summary.previousCarryover = summarizeWeeklyPlanRows([]);
  source.summary.olderCarryover = summarizeWeeklyPlanRows([]);
  source.summary.carryover = summarizeWeeklyPlanRows([]);
  source.summary.execution = source.summary.current;
  const workbook = createWeeklyPlanExportWorkbook({ dataset: source, version: 'full', range: 'current' });
  const sheet = workbook.getWorksheet('生产计划打印版')!;
  assert.equal(sheet.getCell('A1').value, '生产计划清单');
  assert.match(String(sheet.getCell('A4').value), /按内部计划完成日/);
  assert.equal((sheet.getCell('G9').value as ExcelJS.CellFormulaValue).result, 2);
  assert.equal(weeklyPlanExportFileName(source, 'full', 'current'), '生产计划_2026-08-31至2026-09-30_完整版_按内部完成日.xlsx');
});
