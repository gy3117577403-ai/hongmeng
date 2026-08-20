import type { Cell, CellValue, Workbook, Worksheet } from 'exceljs';

export const EXCEL_THEME = {
  ink: 'FF10233F',
  muted: 'FF667085',
  line: 'FFD8E0E8',
  softLine: 'FFE8EDF2',
  paper: 'FFFFFFFF',
  canvas: 'FFF4F7F9',
  green: 'FF0F5C2E',
  greenSoft: 'FFE9F6EE',
  blue: 'FF1D5DB5',
  blueSoft: 'FFEAF2FD',
  orange: 'FFE85D04',
  orangeSoft: 'FFFFF1E8',
  amber: 'FFB77900',
  amberSoft: 'FFFFF6DD',
  red: 'FFC93636',
  redSoft: 'FFFDECEC',
  purple: 'FF7247B8',
  purpleSoft: 'FFF2ECFC',
} as const;

export type ExcelTone = 'green' | 'blue' | 'orange' | 'amber' | 'red' | 'purple';
export type BusinessExcelValue = string | number | boolean | Date | null | undefined;

export interface BusinessExcelKpi {
  icon?: string;
  label: string;
  value: string | number;
  unit?: string;
  note?: string;
  tone?: ExcelTone;
}

export interface BusinessExcelReportInput {
  title: string;
  subtitle?: string;
  sheetName?: string;
  period: string;
  scope?: string;
  generatedAt: string;
  method: string;
  headers: string[];
  rows: BusinessExcelValue[][];
  kpis: BusinessExcelKpi[];
}

const TONE_COLORS: Record<ExcelTone, { strong: string; soft: string }> = {
  green: { strong: EXCEL_THEME.green, soft: EXCEL_THEME.greenSoft },
  blue: { strong: EXCEL_THEME.blue, soft: EXCEL_THEME.blueSoft },
  orange: { strong: EXCEL_THEME.orange, soft: EXCEL_THEME.orangeSoft },
  amber: { strong: EXCEL_THEME.amber, soft: EXCEL_THEME.amberSoft },
  red: { strong: EXCEL_THEME.red, soft: EXCEL_THEME.redSoft },
  purple: { strong: EXCEL_THEME.purple, soft: EXCEL_THEME.purpleSoft },
};

export function excelColumnName(column: number): string {
  let value = column;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

export function safeExcelSheetName(value: string): string {
  const cleaned = value.replace(/[\\/?*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim();
  return (cleaned || '业务报表').slice(0, 31);
}

function visualLength(value: unknown): number {
  return [...String(value ?? '')].reduce((total, char) => total + (/[^\x00-\xff]/.test(char) ? 2 : 1), 0);
}

function fill(argb: string) {
  return { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } };
}

function thinBorder(argb: string = EXCEL_THEME.line) {
  const edge = { style: 'thin' as const, color: { argb } };
  return { top: edge, left: edge, bottom: edge, right: edge };
}

function styleMergedCell(
  sheet: Worksheet,
  row: number,
  startColumn: number,
  endColumn: number,
  value: CellValue,
  options: {
    font?: Cell['font'];
    fill?: string;
    alignment?: Cell['alignment'];
    border?: Cell['border'];
    numFmt?: string;
  } = {},
): Cell {
  if (endColumn > startColumn) sheet.mergeCells(row, startColumn, row, endColumn);
  const cell = sheet.getCell(row, startColumn);
  cell.value = value;
  if (options.font) cell.font = options.font;
  if (options.fill) cell.fill = fill(options.fill);
  if (options.alignment) cell.alignment = options.alignment;
  if (options.border) cell.border = options.border;
  if (options.numFmt) cell.numFmt = options.numFmt;
  return cell;
}

function coerceBusinessValue(value: BusinessExcelValue, header: string): { value: CellValue; numFmt?: string } {
  if (value === undefined || value === null) return { value: '' };
  if (value instanceof Date || typeof value === 'number' || typeof value === 'boolean') {
    if (typeof value === 'number' && /(达成率|出勤率|完成率|占比|完整率|通过率)/.test(header)) {
      return { value: value > 1 ? value / 10_000 : value, numFmt: '0.0%' };
    }
    return { value };
  }
  const trimmed = value.trim();
  const percent = /^(-?\d+(?:\.\d+)?)%$/.exec(trimmed);
  if (percent) return { value: Number(percent[1]) / 100, numFmt: '0.0%' };
  const hours = /^(-?\d+(?:\.\d+)?)h$/i.exec(trimmed);
  if (hours) return { value: Number(hours[1]), numFmt: '0.0" h"' };
  return { value };
}

function styleBusinessCell(cell: Cell, header: string, rowIndex: number): void {
  cell.font = { name: 'Microsoft YaHei', size: 10, color: { argb: EXCEL_THEME.ink } };
  cell.alignment = {
    vertical: 'middle',
    horizontal: typeof cell.value === 'number' ? 'right' : 'left',
    wrapText: true,
  };
  cell.border = thinBorder(EXCEL_THEME.softLine);
  cell.fill = fill(rowIndex % 2 === 0 ? 'FFF8FAFC' : EXCEL_THEME.paper);

  const text = String(cell.text || cell.value || '');
  if (/(逾期|缺失|未发布|未匹配|异常|缺勤|驳回|待处理)/.test(text)) {
    cell.fill = fill(EXCEL_THEME.redSoft);
    cell.font = { ...cell.font, color: { argb: EXCEL_THEME.red }, bold: true };
  } else if (/(完成|已发布|已关闭|已确认|通过|正常)/.test(text)) {
    cell.fill = fill(EXCEL_THEME.greenSoft);
    cell.font = { ...cell.font, color: { argb: EXCEL_THEME.green }, bold: true };
  }

  if (typeof cell.value === 'number' && /(达成率|出勤率|完成率|占比|完整率|通过率)/.test(header)) {
    const rate = Number(cell.value);
    cell.alignment = { vertical: 'middle', horizontal: 'right' };
    if (rate < 0.85) {
      cell.fill = fill(EXCEL_THEME.redSoft);
      cell.font = { ...cell.font, color: { argb: EXCEL_THEME.red }, bold: true };
    } else if (rate < 0.95) {
      cell.fill = fill(EXCEL_THEME.amberSoft);
      cell.font = { ...cell.font, color: { argb: EXCEL_THEME.amber }, bold: true };
    } else {
      cell.fill = fill(EXCEL_THEME.greenSoft);
      cell.font = { ...cell.font, color: { argb: EXCEL_THEME.green }, bold: true };
    }
  }
}

/**
 * Populate a single-sheet, print-ready business report. The function is runtime-neutral:
 * callers create the ExcelJS Workbook on the server or lazily in the browser.
 */
export function populateBusinessReportWorkbook(workbook: Workbook, input: BusinessExcelReportInput): Worksheet {
  workbook.creator = '杭连电子协同平台';
  workbook.lastModifiedBy = '杭连电子协同平台';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const sheet = workbook.addWorksheet(safeExcelSheetName(input.sheetName || input.title), {
    properties: { defaultRowHeight: 20 },
    views: [{ showGridLines: false, zoomScale: 90 }],
  });
  const headerCount = Math.max(1, input.headers.length);
  const canvasColumns = Math.max(4, headerCount);
  const lastColumnName = excelColumnName(canvasColumns);

  sheet.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 },
  };

  styleMergedCell(sheet, 1, 1, canvasColumns, input.title, {
    font: { name: 'Microsoft YaHei', size: 22, bold: true, color: { argb: EXCEL_THEME.green } },
    alignment: { horizontal: 'center', vertical: 'middle' },
  });
  sheet.getRow(1).height = 34;
  styleMergedCell(sheet, 2, 1, canvasColumns, input.subtitle || '业务数据导出', {
    font: { name: 'Microsoft YaHei', size: 10, color: { argb: EXCEL_THEME.muted } },
    alignment: { horizontal: 'center', vertical: 'middle' },
  });
  sheet.getRow(2).height = 18;
  styleMergedCell(
    sheet,
    3,
    1,
    canvasColumns,
    `统计范围：${input.period}${input.scope ? `    数据范围：${input.scope}` : ''}    生成时间：${input.generatedAt}`,
    {
      font: { name: 'Microsoft YaHei', size: 9.5, color: { argb: EXCEL_THEME.ink } },
      fill: EXCEL_THEME.canvas,
      alignment: { horizontal: 'left', vertical: 'middle', indent: 1 },
      border: thinBorder(),
    },
  );
  sheet.getRow(3).height = 23;

  const kpis = input.kpis.slice(0, 4);
  const kpiCount = Math.max(1, kpis.length);
  let cursor = 1;
  kpis.forEach((kpi, index) => {
    const remainingColumns = canvasColumns - cursor + 1;
    const remainingKpis = kpiCount - index;
    const span = Math.max(1, Math.floor(remainingColumns / remainingKpis));
    const endColumn = index === kpiCount - 1 ? canvasColumns : Math.min(canvasColumns, cursor + span - 1);
    const tone = TONE_COLORS[kpi.tone || (index === 0 ? 'orange' : index === 1 ? 'green' : index === 2 ? 'blue' : 'red')];
    styleMergedCell(sheet, 4, cursor, endColumn, `${kpi.icon || ['◷', '✓', '↗', '!'][index] || '•'}  ${kpi.label}`, {
      font: { name: 'Microsoft YaHei', size: 10.5, bold: true, color: { argb: tone.strong } },
      fill: tone.soft,
      alignment: { horizontal: 'left', vertical: 'middle', indent: 1 },
      border: thinBorder(tone.soft),
    });
    styleMergedCell(sheet, 5, cursor, endColumn, `${kpi.value}${kpi.unit ? ` ${kpi.unit}` : ''}`, {
      font: { name: 'Microsoft YaHei', size: 18, bold: true, color: { argb: EXCEL_THEME.ink } },
      fill: tone.soft,
      alignment: { horizontal: 'left', vertical: 'middle', indent: 1 },
      border: thinBorder(tone.soft),
    });
    styleMergedCell(sheet, 6, cursor, endColumn, kpi.note || '', {
      font: { name: 'Microsoft YaHei', size: 8.5, color: { argb: EXCEL_THEME.muted } },
      fill: tone.soft,
      alignment: { horizontal: 'left', vertical: 'middle', indent: 1, wrapText: true },
      border: thinBorder(tone.soft),
    });
    cursor = endColumn + 1;
  });
  sheet.getRow(4).height = 21;
  sheet.getRow(5).height = 28;
  sheet.getRow(6).height = 23;
  sheet.getRow(7).height = 6;

  const tableHeaderRow = 8;
  input.headers.forEach((header, index) => {
    const cell = sheet.getCell(tableHeaderRow, index + 1);
    cell.value = header;
    cell.font = { name: 'Microsoft YaHei', size: 10.5, bold: true, color: { argb: EXCEL_THEME.paper } };
    cell.fill = fill(EXCEL_THEME.green);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = thinBorder('FF2E6F48');
  });
  for (let column = headerCount + 1; column <= canvasColumns; column += 1) {
    const cell = sheet.getCell(tableHeaderRow, column);
    cell.fill = fill(EXCEL_THEME.green);
    cell.border = thinBorder('FF2E6F48');
  }
  sheet.getRow(tableHeaderRow).height = 27;

  const bodyRows = input.rows.length ? input.rows : [['当前筛选范围暂无数据']];
  bodyRows.forEach((row, rowIndex) => {
    const excelRow = tableHeaderRow + 1 + rowIndex;
    input.headers.forEach((header, columnIndex) => {
      const cell = sheet.getCell(excelRow, columnIndex + 1);
      const normalized = coerceBusinessValue(row[columnIndex], header);
      cell.value = normalized.value;
      if (normalized.numFmt) cell.numFmt = normalized.numFmt;
      else if (typeof normalized.value === 'number') cell.numFmt = '#,##0.##';
      styleBusinessCell(cell, header, rowIndex);
    });
    if (!input.rows.length) {
      sheet.mergeCells(excelRow, 1, excelRow, canvasColumns);
      const emptyCell = sheet.getCell(excelRow, 1);
      emptyCell.alignment = { horizontal: 'center', vertical: 'middle' };
      emptyCell.font = { name: 'Microsoft YaHei', size: 10, color: { argb: EXCEL_THEME.muted }, italic: true };
    }
    sheet.getRow(excelRow).height = 23;
  });

  const bodyStartRow = tableHeaderRow + 1;
  const bodyEndRow = tableHeaderRow + bodyRows.length;
  if (input.rows.length && input.headers.length) {
    sheet.autoFilter = {
      from: { row: tableHeaderRow, column: 1 },
      to: { row: tableHeaderRow, column: input.headers.length },
    };
  }
  sheet.views = [{
    state: 'frozen',
    xSplit: 1,
    ySplit: tableHeaderRow,
    topLeftCell: `B${bodyStartRow}`,
    activeCell: `A${bodyStartRow}`,
    showGridLines: false,
    zoomScale: 90,
  }];

  const noteRow = bodyEndRow + 1;
  styleMergedCell(sheet, noteRow, 1, canvasColumns, `统计说明：${input.method}`, {
    font: { name: 'Microsoft YaHei', size: 9, color: { argb: EXCEL_THEME.green } },
    fill: EXCEL_THEME.greenSoft,
    alignment: { horizontal: 'left', vertical: 'middle', indent: 1, wrapText: true },
    border: thinBorder('FFCDE6D6'),
  });
  sheet.getRow(noteRow).height = 28;

  input.headers.forEach((header, index) => {
    const sampleValues = input.rows.slice(0, 100).map(row => row[index]);
    const width = Math.min(34, Math.max(11, Math.ceil(Math.max(visualLength(header), ...sampleValues.map(visualLength)) / 2) + 3));
    sheet.getColumn(index + 1).width = width;
  });
  for (let column = headerCount + 1; column <= canvasColumns; column += 1) sheet.getColumn(column).width = 4;

  sheet.pageSetup.printArea = `A1:${lastColumnName}${noteRow}`;
  sheet.pageSetup.printTitlesRow = '1:8';
  sheet.headerFooter.oddFooter = '&L杭连电子协同平台&C第 &P / &N 页&R业务报表';
  sheet.getRows(bodyStartRow, Math.max(0, bodyEndRow - bodyStartRow + 1))?.forEach(row => {
    row.eachCell(cell => {
      if (cell.numFmt === '0.0%' && typeof cell.value === 'number') {
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      }
    });
  });

  return sheet;
}
