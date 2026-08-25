import ExcelJS, { type Cell, type Worksheet } from 'exceljs';
import sharp from 'sharp';
import { EXCEL_THEME, excelColumnName, safeExcelSheetName } from '@/lib/business-excel';
import { attendanceDayMetrics } from '@/lib/report-labor-metrics';
import { isEmployeeHiredOnDate } from '@/lib/production-workforce';
import { resolveAttendanceCalendarDay, type EffectiveAttendanceCalendarDayType } from '@/lib/attendance-calendar';

export type AttendanceWorkbookStatus = 'confirmed' | 'draft';
export type AttendanceWorkbookType = 'normal' | 'leave' | 'absent' | 'rest';

export interface AttendanceWorkbookEmployee {
  id: string;
  employeeNo: string;
  name: string;
  department: string | null;
  team: string | null;
  position: string | null;
  hireDate?: string | null;
}

export interface AttendanceWorkbookRecord {
  employeeId: string;
  dateKey: string;
  status: AttendanceWorkbookStatus;
  attendanceType: AttendanceWorkbookType;
  plannedMilliseconds: number;
  actualMilliseconds: number;
  overtimeMilliseconds: number;
  leaveMilliseconds: number;
  remark: string | null;
}

export interface AttendanceWorkbookInput {
  startDate: string;
  endDate: string;
  periodLabel: string;
  scopeLabel: string;
  generatedAt: string;
  employees: AttendanceWorkbookEmployee[];
  records: AttendanceWorkbookRecord[];
  dateKeys: string[];
  calendarDays?: Array<{
    dateKey: string;
    effectiveDayType: EffectiveAttendanceCalendarDayType;
    label: string | null;
    isWorkday: boolean;
  }>;
}

export interface AttendanceWorkbookResult {
  buffer: Buffer;
  employeeCount: number;
  confirmedRecordCount: number;
  draftRecordCount: number;
  missingRecordCount: number;
}

const MAIN_HEADER_ROW = 8;
const BODY_START_ROW = MAIN_HEADER_ROW + 1;
const IDENTITY_COLUMN_COUNT = 5;

function hours(milliseconds: number): number {
  return Number((Math.max(0, milliseconds) / 3_600_000).toFixed(2));
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char] || char));
}

function fill(argb: string) {
  return { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } };
}

function border(argb: string = EXCEL_THEME.line) {
  const edge = { style: 'thin' as const, color: { argb } };
  return { top: edge, left: edge, bottom: edge, right: edge };
}

function setMergedCell(
  sheet: Worksheet,
  row: number,
  startColumn: number,
  endColumn: number,
  value: ExcelJS.CellValue,
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

function weekday(dateKey: string): { label: string; weekend: 'saturday' | 'sunday' | null } {
  const date = new Date(`${dateKey}T12:00:00+08:00`);
  const day = date.getDay();
  return {
    label: new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'Asia/Shanghai' }).format(date),
    weekend: day === 6 ? 'saturday' : day === 0 ? 'sunday' : null,
  };
}

function attendanceCellValue(record: AttendanceWorkbookRecord | undefined): string | number {
  if (!record) return '';
  if (record.status !== 'confirmed') return '待';
  if (record.attendanceType === 'rest') return '休';
  if (record.attendanceType === 'leave' && record.actualMilliseconds <= 0) return '假';
  if (record.attendanceType === 'absent') return '缺';
  return hours(record.actualMilliseconds);
}

function attendanceCellNote(record: AttendanceWorkbookRecord | undefined): string | undefined {
  if (!record) return '未登记考勤，不计入正式统计。';
  if (record.status !== 'confirmed') return `草稿记录，不计入正式统计${record.remark ? `。备注：${record.remark}` : ''}`;
  const parts = [
    `有效出勤 ${hours(record.actualMilliseconds)} 小时`,
    `加班 ${hours(record.overtimeMilliseconds)} 小时`,
    `请假 ${hours(record.leaveMilliseconds)} 小时`,
  ];
  if (record.remark) parts.push(`备注：${record.remark}`);
  return parts.join('；');
}

function statusStyle(cell: Cell, value: string | number, weekend: 'saturday' | 'sunday' | null): void {
  cell.font = { name: 'Microsoft YaHei', size: 9.5, color: { argb: EXCEL_THEME.ink } };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  cell.border = border(EXCEL_THEME.softLine);
  cell.fill = fill(weekend ? 'FFF8FAFD' : EXCEL_THEME.paper);
  cell.numFmt = '0.0';
  if (value === '休') {
    cell.fill = fill('FFF1F4F7');
    cell.font = { ...cell.font, color: { argb: EXCEL_THEME.muted }, bold: true };
  } else if (value === '假') {
    cell.fill = fill(EXCEL_THEME.amberSoft);
    cell.font = { ...cell.font, color: { argb: EXCEL_THEME.amber }, bold: true };
  } else if (value === '缺') {
    cell.fill = fill(EXCEL_THEME.redSoft);
    cell.font = { ...cell.font, color: { argb: EXCEL_THEME.red }, bold: true };
  } else if (value === '待') {
    cell.fill = fill(EXCEL_THEME.purpleSoft);
    cell.font = { ...cell.font, color: { argb: EXCEL_THEME.purple }, bold: true };
  } else if (value === '未') {
    cell.fill = fill('FFF1F4F7');
    cell.font = { ...cell.font, color: { argb: EXCEL_THEME.muted }, bold: true };
  } else if (value === '周休') {
    cell.fill = fill('FFF7F2F3');
    cell.font = { ...cell.font, color: { argb: 'FF9B6267' }, bold: true };
  } else if (value === '节') {
    cell.fill = fill(EXCEL_THEME.redSoft);
    cell.font = { ...cell.font, color: { argb: EXCEL_THEME.red }, bold: true };
  }
}

function rateFormula(actualHours: number, expectedHours: number, expectedRef: string, actualRef: string) {
  return {
    formula: `IF(${expectedRef}=0,"",MIN(1,MAX(0,${actualRef}/${expectedRef})))`,
    result: expectedHours > 0 ? Math.min(1, Math.max(0, actualHours / expectedHours)) : '',
  };
}

async function renderAttendanceTrend(
  dateKeys: string[],
  totals: number[],
  averages: number[],
): Promise<Buffer> {
  const width = 900;
  const height = 265;
  const plot = { left: 58, right: 24, top: 50, bottom: 45 };
  const innerWidth = width - plot.left - plot.right;
  const innerHeight = height - plot.top - plot.bottom;
  const maxTotal = Math.max(1, ...totals);
  const maxAverage = Math.max(1, ...averages);
  const step = innerWidth / Math.max(1, dateKeys.length);
  const barWidth = Math.max(3, Math.min(18, step * 0.52));
  const bars = totals.map((value, index) => {
    const h = value / maxTotal * innerHeight;
    const x = plot.left + index * step + (step - barWidth) / 2;
    return `<rect x="${x.toFixed(1)}" y="${(plot.top + innerHeight - h).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="#8EC5A2"/>`;
  }).join('');
  const linePoints = averages.map((value, index) => {
    const x = plot.left + index * step + step / 2;
    const y = plot.top + innerHeight - value / maxAverage * innerHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const labelStep = Math.max(1, Math.ceil(dateKeys.length / 16));
  const labels = dateKeys.map((key, index) => {
    if (index % labelStep !== 0 && index !== dateKeys.length - 1) return '';
    const x = plot.left + index * step + step / 2;
    return `<text x="${x.toFixed(1)}" y="${height - 18}" text-anchor="middle" font-size="11" fill="#667085">${escapeXml(key.slice(5))}</text>`;
  }).join('');
  const totalText = totals.reduce((sum, value) => sum + value, 0);
  return sharp(Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" rx="16" fill="#FFFFFF" stroke="#D8E0E8"/>
    <text x="24" y="29" font-family="Microsoft YaHei,Arial" font-size="16" font-weight="700" fill="#10233F">每日出勤小时趋势</text>
    <text x="${width - 24}" y="29" text-anchor="end" font-family="Microsoft YaHei,Arial" font-size="12" fill="#667085">周期合计 ${totalText.toFixed(1)} 小时</text>
    <line x1="${plot.left}" y1="${plot.top + innerHeight}" x2="${width - plot.right}" y2="${plot.top + innerHeight}" stroke="#D8E0E8"/>
    ${bars}
    <polyline points="${linePoints}" fill="none" stroke="#1D5DB5" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    ${labels}
    <circle cx="${plot.left}" cy="${height - 7}" r="4" fill="#8EC5A2"/><text x="${plot.left + 10}" y="${height - 3}" font-family="Microsoft YaHei,Arial" font-size="10" fill="#667085">每日合计</text>
    <line x1="${plot.left + 86}" y1="${height - 7}" x2="${plot.left + 102}" y2="${height - 7}" stroke="#1D5DB5" stroke-width="3"/><text x="${plot.left + 108}" y="${height - 3}" font-family="Microsoft YaHei,Arial" font-size="10" fill="#667085">人均工时</text>
  </svg>`)).png().toBuffer();
}

async function renderOvertimeRanking(rows: Array<{ name: string; overtime: number }>): Promise<Buffer> {
  const width = 540;
  const height = 265;
  const ranked = [...rows].sort((a, b) => b.overtime - a.overtime).slice(0, 10);
  const max = Math.max(1, ...ranked.map(row => row.overtime));
  const startY = 48;
  const rowHeight = ranked.length ? Math.min(20, 180 / ranked.length) : 20;
  const bars = ranked.length ? ranked.map((row, index) => {
    const y = startY + index * rowHeight;
    const barWidth = row.overtime / max * 300;
    const name = [...row.name].slice(0, 7).join('');
    return `<text x="22" y="${y + 12}" font-family="Microsoft YaHei,Arial" font-size="11" fill="#10233F">${escapeXml(name)}</text>
      <rect x="112" y="${y + 2}" width="300" height="11" rx="5.5" fill="#EEF2F6"/>
      <rect x="112" y="${y + 2}" width="${barWidth.toFixed(1)}" height="11" rx="5.5" fill="#4E9C64"/>
      <text x="425" y="${y + 12}" font-family="Microsoft YaHei,Arial" font-size="11" font-weight="700" fill="#0F5C2E">${row.overtime.toFixed(1)}h</text>`;
  }).join('') : `<text x="270" y="140" text-anchor="middle" font-family="Microsoft YaHei,Arial" font-size="14" fill="#98A2B3">当前周期没有已确认加班</text>`;
  return sharp(Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" rx="16" fill="#FFFFFF" stroke="#D8E0E8"/>
    <text x="22" y="29" font-family="Microsoft YaHei,Arial" font-size="16" font-weight="700" fill="#10233F">加班时长 Top 10</text>
    ${bars}
  </svg>`)).png().toBuffer();
}

function setCard(
  sheet: Worksheet,
  startColumn: number,
  endColumn: number,
  label: string,
  icon: string,
  formula: ExcelJS.CellFormulaValue | number,
  note: string,
  tone: { strong: string; soft: string },
  numFmt: string,
): void {
  setMergedCell(sheet, 3, startColumn, endColumn, `${icon}  ${label}`, {
    font: { name: 'Microsoft YaHei', size: 10.5, bold: true, color: { argb: tone.strong } },
    fill: tone.soft,
    alignment: { horizontal: 'left', vertical: 'middle', indent: 1 },
    border: border(tone.soft),
  });
  setMergedCell(sheet, 4, startColumn, endColumn, formula, {
    font: { name: 'Microsoft YaHei', size: 18, bold: true, color: { argb: EXCEL_THEME.ink } },
    fill: tone.soft,
    alignment: { horizontal: 'left', vertical: 'middle', indent: 1 },
    border: border(tone.soft),
    numFmt,
  });
  setMergedCell(sheet, 5, startColumn, endColumn, note, {
    font: { name: 'Microsoft YaHei', size: 8.5, color: { argb: EXCEL_THEME.muted } },
    fill: tone.soft,
    alignment: { horizontal: 'left', vertical: 'middle', indent: 1, wrapText: true },
    border: border(tone.soft),
  });
}

export async function createAttendanceWorkbook(input: AttendanceWorkbookInput): Promise<AttendanceWorkbookResult> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '杭连电子协同平台';
  workbook.lastModifiedBy = '杭连电子协同平台';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  const sheet = workbook.addWorksheet(safeExcelSheetName('员工出勤记录表'), {
    properties: { defaultRowHeight: 20 },
    views: [{ showGridLines: false, zoomScale: input.dateKeys.length > 20 ? 80 : 90 }],
  });

  const dateCount = input.dateKeys.length;
  const plannedColumn = IDENTITY_COLUMN_COUNT + dateCount + 1;
  const actualColumn = plannedColumn + 1;
  const overtimeColumn = plannedColumn + 2;
  const rateColumn = plannedColumn + 3;
  const totalColumns = rateColumn;
  const lastColumnName = excelColumnName(totalColumns);
  const employeeEndRow = BODY_START_ROW + input.employees.length - 1;
  const totalRow = Math.max(BODY_START_ROW, employeeEndRow + 1);
  const averageRow = totalRow + 1;

  const recordMap = new Map(input.records.map(record => [`${record.employeeId}:${record.dateKey}`, record]));
  const calendarByDate = new Map((input.calendarDays || input.dateKeys.map(dateKey => {
    const day = resolveAttendanceCalendarDay(dateKey);
    return { dateKey, effectiveDayType: day.effectiveDayType, label: day.label, isWorkday: day.isWorkday };
  })).map(day => [day.dateKey, day]));
  const employeeTotals = input.employees.map(employee => {
    const confirmed = input.dateKeys
      .filter(dateKey => isEmployeeHiredOnDate(employee, dateKey) && calendarByDate.get(dateKey)?.isWorkday !== false)
      .map(dateKey => recordMap.get(`${employee.id}:${dateKey}`))
      .filter((record): record is AttendanceWorkbookRecord => record?.status === 'confirmed');
    const metrics = confirmed.map(record => attendanceDayMetrics({
      attendanceType: record.attendanceType,
      scheduledMilliseconds: record.plannedMilliseconds,
      plannedOvertimeMilliseconds: 0,
      actualOvertimeMilliseconds: record.overtimeMilliseconds,
      leaveMilliseconds: record.leaveMilliseconds,
      actualAttendanceMilliseconds: record.actualMilliseconds,
      overtimeBasis: 'actual_confirmed',
    }));
    const expected = hours(metrics.reduce((sum, metric) => sum + metric.netExpectedMilliseconds, 0));
    const actual = hours(metrics.reduce((sum, metric) => sum + metric.actualAttendanceMilliseconds, 0));
    const overtime = hours(metrics.reduce((sum, metric) => sum + metric.actualOvertimeMilliseconds, 0));
    const extra = hours(metrics.reduce((sum, metric) => sum + metric.extraAttendanceMilliseconds, 0));
    return {
      employee,
      expected,
      actual,
      overtime,
      extra,
      rate: expected > 0 ? Math.min(1, Math.max(0, actual / expected)) : null,
    };
  });
  const expectedTotal = Number(employeeTotals.reduce((sum, row) => sum + row.expected, 0).toFixed(2));
  const actualTotal = Number(employeeTotals.reduce((sum, row) => sum + row.actual, 0).toFixed(2));
  const overtimeTotal = Number(employeeTotals.reduce((sum, row) => sum + row.overtime, 0).toFixed(2));
  const rateTotal = expectedTotal > 0 ? Math.min(1, Math.max(0, actualTotal / expectedTotal)) : 0;
  const confirmedRecordCount = input.records.filter(record => record.status === 'confirmed' && calendarByDate.get(record.dateKey)?.isWorkday !== false).length;
  const draftRecordCount = input.records.filter(record => record.status === 'draft' && calendarByDate.get(record.dateKey)?.isWorkday !== false).length;
  const eligibleEmployeeDays = input.employees.reduce((sum, employee) => (
    sum + input.dateKeys.filter(dateKey => isEmployeeHiredOnDate(employee, dateKey) && calendarByDate.get(dateKey)?.isWorkday !== false).length
  ), 0);
  const effectiveRecordCount = input.records.filter(record => calendarByDate.get(record.dateKey)?.isWorkday !== false).length;
  const missingRecordCount = Math.max(0, eligibleEmployeeDays - effectiveRecordCount);

  sheet.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.2, right: 0.2, top: 0.3, bottom: 0.3, header: 0.12, footer: 0.12 },
  };

  setMergedCell(sheet, 1, 1, totalColumns, '员工出勤记录表（小时制）', {
    font: { name: 'Microsoft YaHei', size: 22, bold: true, color: { argb: EXCEL_THEME.green } },
    alignment: { horizontal: 'center', vertical: 'middle' },
  });
  sheet.getRow(1).height = 34;
  setMergedCell(sheet, 2, 1, totalColumns, `部门/范围：${input.scopeLabel}    统计周期：${input.periodLabel}    员工：${input.employees.length} 人    数据截止：${input.generatedAt}`, {
    font: { name: 'Microsoft YaHei', size: 9.5, color: { argb: EXCEL_THEME.ink } },
    fill: EXCEL_THEME.canvas,
    alignment: { horizontal: 'left', vertical: 'middle', indent: 1 },
    border: border(),
  });
  sheet.getRow(2).height = 23;

  const cardSpans: Array<[number, number]> = [];
  let cardCursor = 1;
  for (let index = 0; index < 4; index += 1) {
    const remainingColumns = totalColumns - cardCursor + 1;
    const remainingCards = 4 - index;
    const span = Math.max(1, Math.floor(remainingColumns / remainingCards));
    const end = index === 3 ? totalColumns : cardCursor + span - 1;
    cardSpans.push([cardCursor, end]);
    cardCursor = end + 1;
  }
  const expectedFormula: ExcelJS.CellFormulaValue | number = input.employees.length
    ? { formula: `SUM(${excelColumnName(plannedColumn)}${BODY_START_ROW}:${excelColumnName(plannedColumn)}${employeeEndRow})`, result: expectedTotal }
    : 0;
  const actualFormula: ExcelJS.CellFormulaValue | number = input.employees.length
    ? { formula: `SUM(${excelColumnName(actualColumn)}${BODY_START_ROW}:${excelColumnName(actualColumn)}${employeeEndRow})`, result: actualTotal }
    : 0;
  const overtimeFormula: ExcelJS.CellFormulaValue | number = input.employees.length
    ? { formula: `SUM(${excelColumnName(overtimeColumn)}${BODY_START_ROW}:${excelColumnName(overtimeColumn)}${employeeEndRow})`, result: overtimeTotal }
    : 0;
  const rateFormulaValue: ExcelJS.CellFormulaValue | number = input.employees.length
    ? {
      formula: `IF(${excelColumnName(cardSpans[0][0])}4=0,"",MIN(1,MAX(0,${excelColumnName(cardSpans[1][0])}4/${excelColumnName(cardSpans[0][0])}4)))`,
      result: rateTotal,
    }
    : 0;
  setCard(sheet, ...cardSpans[0], '净应出勤小时数', '应', expectedFormula, '排班 + 认可加班 - 已确认请假', { strong: EXCEL_THEME.green, soft: EXCEL_THEME.greenSoft }, '#,##0.0');
  setCard(sheet, ...cardSpans[1], '实际出勤小时数', '实', actualFormula, '有效出勤，包含已确认加班', { strong: EXCEL_THEME.blue, soft: EXCEL_THEME.blueSoft }, '#,##0.0');
  setCard(sheet, ...cardSpans[2], '加班小时数', '加', overtimeFormula, '直接取已确认加班时段', { strong: EXCEL_THEME.orange, soft: EXCEL_THEME.orangeSoft }, '#,##0.0');
  setCard(sheet, ...cardSpans[3], '出勤得分', '率', rateFormulaValue, '实际出勤 ÷ 净应出勤，最高 100%', { strong: EXCEL_THEME.green, soft: EXCEL_THEME.greenSoft }, '0.0%');
  sheet.getRow(3).height = 21;
  sheet.getRow(4).height = 28;
  sheet.getRow(5).height = 23;

  setMergedCell(sheet, 6, 1, totalColumns, '填写说明：数字=已确认实际小时（含加班）  休=休息  假=请假  缺=缺勤  待=草稿  未=尚未入职  空白=未登记；草稿、未登记与未入职不进入正式统计。', {
    font: { name: 'Microsoft YaHei', size: 9, color: { argb: EXCEL_THEME.muted } },
    fill: 'FFFFFBEB',
    alignment: { horizontal: 'left', vertical: 'middle', indent: 1, wrapText: true },
    border: border('FFF0D891'),
  });
  sheet.getRow(6).height = 25;

  setMergedCell(sheet, 7, 1, IDENTITY_COLUMN_COUNT, '员工信息', {
    font: { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: EXCEL_THEME.paper } },
    fill: EXCEL_THEME.green,
    alignment: { horizontal: 'center', vertical: 'middle' },
    border: border('FF2E6F48'),
  });
  if (dateCount) setMergedCell(sheet, 7, IDENTITY_COLUMN_COUNT + 1, IDENTITY_COLUMN_COUNT + dateCount, '每日实际出勤小时数（含加班）', {
    font: { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: EXCEL_THEME.paper } },
    fill: EXCEL_THEME.green,
    alignment: { horizontal: 'center', vertical: 'middle' },
    border: border('FF2E6F48'),
  });
  setMergedCell(sheet, 7, plannedColumn, rateColumn, '周期汇总', {
    font: { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: EXCEL_THEME.paper } },
    fill: EXCEL_THEME.green,
    alignment: { horizontal: 'center', vertical: 'middle' },
    border: border('FF2E6F48'),
  });
  sheet.getRow(7).height = 21;

  const identityHeaders = ['序号', '员工姓名', '工号', '岗位', '班组'];
  identityHeaders.forEach((header, index) => {
    const cell = sheet.getCell(MAIN_HEADER_ROW, index + 1);
    cell.value = header;
    cell.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: EXCEL_THEME.paper } };
    cell.fill = fill(EXCEL_THEME.green);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = border('FF2E6F48');
  });
  input.dateKeys.forEach((dateKey, index) => {
    const info = weekday(dateKey);
    const cell = sheet.getCell(MAIN_HEADER_ROW, IDENTITY_COLUMN_COUNT + index + 1);
    cell.value = `${Number(dateKey.slice(8))}\n${info.label}`;
    cell.font = {
      name: 'Microsoft YaHei',
      size: 9,
      bold: true,
      color: { argb: info.weekend === 'sunday' ? 'FFFF5B5B' : info.weekend === 'saturday' ? 'FF7DB7FF' : EXCEL_THEME.paper },
    };
    cell.fill = fill(EXCEL_THEME.green);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = border('FF2E6F48');
  });
  ['净应出勤', '实际出勤小时', '加班小时', '出勤得分'].forEach((header, index) => {
    const cell = sheet.getCell(MAIN_HEADER_ROW, plannedColumn + index);
    cell.value = header;
    cell.font = { name: 'Microsoft YaHei', size: 9.5, bold: true, color: { argb: EXCEL_THEME.paper } };
    cell.fill = fill(EXCEL_THEME.green);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = border('FF2E6F48');
  });
  sheet.getRow(MAIN_HEADER_ROW).height = 35;

  const dailyTotals = input.dateKeys.map(() => 0);
  const dailyPeople = input.dateKeys.map(() => 0);
  employeeTotals.forEach((summary, employeeIndex) => {
    const rowNumber = BODY_START_ROW + employeeIndex;
    const employee = summary.employee;
    const identityValues: Array<string | number> = [employeeIndex + 1, employee.name, employee.employeeNo, employee.position || '未设置', employee.team || employee.department || '未分组'];
    identityValues.forEach((value, index) => {
      const cell = sheet.getCell(rowNumber, index + 1);
      cell.value = value;
      cell.font = { name: 'Microsoft YaHei', size: 9.5, color: { argb: EXCEL_THEME.ink }, bold: index === 1 };
      cell.fill = fill(employeeIndex % 2 ? 'FFF8FAFC' : EXCEL_THEME.paper);
      cell.alignment = { horizontal: index === 0 ? 'center' : 'left', vertical: 'middle', wrapText: true };
      cell.border = border(EXCEL_THEME.softLine);
    });
    input.dateKeys.forEach((dateKey, dayIndex) => {
      const record = recordMap.get(`${employee.id}:${dateKey}`);
      const employed = isEmployeeHiredOnDate(employee, dateKey);
      const calendar = calendarByDate.get(dateKey);
      const value = calendar?.isWorkday === false
        ? calendar.effectiveDayType === 'holiday' ? '节' : '周休'
        : employed ? attendanceCellValue(record) : '未';
      const cell = sheet.getCell(rowNumber, IDENTITY_COLUMN_COUNT + dayIndex + 1);
      cell.value = value;
      const note = calendar?.isWorkday === false
        ? `${calendar.label || (calendar.effectiveDayType === 'holiday' ? '节假日' : '每周日固定周休')}，不计入出勤与得分基数；历史记录保留但不参与汇总。`
        : employed ? attendanceCellNote(record) : '尚未入职，不计入考勤与达成率基数。';
      if (note) cell.note = note;
      statusStyle(cell, value, weekday(dateKey).weekend);
      if (typeof value === 'number') {
        dailyTotals[dayIndex] += value;
        dailyPeople[dayIndex] += 1;
      }
    });

    const actualStart = `${excelColumnName(IDENTITY_COLUMN_COUNT + 1)}${rowNumber}`;
    const actualEnd = `${excelColumnName(IDENTITY_COLUMN_COUNT + dateCount)}${rowNumber}`;
    const plannedCell = sheet.getCell(rowNumber, plannedColumn);
    plannedCell.value = summary.expected;
    const actualCell = sheet.getCell(rowNumber, actualColumn);
    actualCell.value = dateCount ? { formula: `SUM(${actualStart}:${actualEnd})`, result: summary.actual } : summary.actual;
    const overtimeCell = sheet.getCell(rowNumber, overtimeColumn);
    overtimeCell.value = summary.overtime;
    const rateCell = sheet.getCell(rowNumber, rateColumn);
    rateCell.value = rateFormula(
      summary.actual,
      summary.expected,
      `${excelColumnName(plannedColumn)}${rowNumber}`,
      `${excelColumnName(actualColumn)}${rowNumber}`,
    );
    [plannedCell, actualCell, overtimeCell, rateCell].forEach((cell, index) => {
      cell.font = { name: 'Microsoft YaHei', size: 9.5, bold: true, color: { argb: index === 3 ? EXCEL_THEME.blue : EXCEL_THEME.ink } };
      cell.fill = fill(employeeIndex % 2 ? 'FFF8FAFC' : EXCEL_THEME.paper);
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
      cell.border = border(EXCEL_THEME.softLine);
      cell.numFmt = index === 3 ? '0.0%' : '#,##0.0';
    });
    if (summary.rate === null) {
      rateCell.fill = fill('FFF1F4F7');
      rateCell.font = { ...rateCell.font, color: { argb: EXCEL_THEME.muted } };
    } else if (summary.rate < 0.85) {
      rateCell.fill = fill(EXCEL_THEME.redSoft);
      rateCell.font = { ...rateCell.font, color: { argb: EXCEL_THEME.red } };
    } else if (summary.rate < 0.95) {
      rateCell.fill = fill(EXCEL_THEME.amberSoft);
      rateCell.font = { ...rateCell.font, color: { argb: EXCEL_THEME.amber } };
    } else {
      rateCell.fill = fill(EXCEL_THEME.greenSoft);
      rateCell.font = { ...rateCell.font, color: { argb: EXCEL_THEME.green } };
    }
    sheet.getRow(rowNumber).height = 23;
  });

  setMergedCell(sheet, totalRow, 1, IDENTITY_COLUMN_COUNT, '每日合计（小时）', {
    font: { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: EXCEL_THEME.paper } },
    fill: EXCEL_THEME.green,
    alignment: { horizontal: 'center', vertical: 'middle' },
    border: border('FF2E6F48'),
  });
  setMergedCell(sheet, averageRow, 1, IDENTITY_COLUMN_COUNT, '每日平均（小时）', {
    font: { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: EXCEL_THEME.green } },
    fill: EXCEL_THEME.greenSoft,
    alignment: { horizontal: 'center', vertical: 'middle' },
    border: border('FFCDE6D6'),
  });
  input.dateKeys.forEach((_, dayIndex) => {
    const column = IDENTITY_COLUMN_COUNT + dayIndex + 1;
    const columnName = excelColumnName(column);
    const totalCell = sheet.getCell(totalRow, column);
    totalCell.value = input.employees.length
      ? { formula: `SUM(${columnName}${BODY_START_ROW}:${columnName}${employeeEndRow})`, result: Number(dailyTotals[dayIndex].toFixed(2)) }
      : 0;
    totalCell.numFmt = '#,##0.0';
    totalCell.font = { name: 'Microsoft YaHei', size: 9.5, bold: true, color: { argb: EXCEL_THEME.paper } };
    totalCell.fill = fill(EXCEL_THEME.green);
    totalCell.alignment = { horizontal: 'right', vertical: 'middle' };
    totalCell.border = border('FF2E6F48');

    const average = dailyPeople[dayIndex] ? dailyTotals[dayIndex] / dailyPeople[dayIndex] : 0;
    const averageCell = sheet.getCell(averageRow, column);
    averageCell.value = input.employees.length
      ? { formula: `IFERROR(AVERAGE(${columnName}${BODY_START_ROW}:${columnName}${employeeEndRow}),0)`, result: Number(average.toFixed(2)) }
      : 0;
    averageCell.numFmt = '#,##0.0';
    averageCell.font = { name: 'Microsoft YaHei', size: 9.5, bold: true, color: { argb: EXCEL_THEME.green } };
    averageCell.fill = fill(EXCEL_THEME.greenSoft);
    averageCell.alignment = { horizontal: 'right', vertical: 'middle' };
    averageCell.border = border('FFCDE6D6');
  });
  for (let column = plannedColumn; column <= rateColumn; column += 1) {
    [sheet.getCell(totalRow, column), sheet.getCell(averageRow, column)].forEach((cell, index) => {
      cell.value = '';
      cell.fill = fill(index === 0 ? EXCEL_THEME.green : EXCEL_THEME.greenSoft);
      cell.border = border(index === 0 ? 'FF2E6F48' : 'FFCDE6D6');
    });
  }

  const summaryTitleRow = averageRow + 1;
  const summaryHeaderRow = summaryTitleRow + 1;
  const summaryDataStart = summaryHeaderRow + 1;
  const summaryColumnCount = Math.min(totalColumns, 16);
  const summarySpans: Array<[number, number]> = [];
  let summaryCursor = 1;
  for (let index = 0; index < 6; index += 1) {
    const remainingColumns = summaryColumnCount - summaryCursor + 1;
    const remainingFields = 6 - index;
    const span = Math.max(1, Math.floor(remainingColumns / remainingFields));
    const end = index === 5 ? summaryColumnCount : summaryCursor + span - 1;
    summarySpans.push([summaryCursor, end]);
    summaryCursor = end + 1;
  }
  setMergedCell(sheet, summaryTitleRow, 1, summaryColumnCount, '出勤汇总（当前统计范围）', {
    font: { name: 'Microsoft YaHei', size: 12, bold: true, color: { argb: EXCEL_THEME.green } },
    fill: EXCEL_THEME.greenSoft,
    alignment: { horizontal: 'left', vertical: 'middle', indent: 1 },
    border: border('FFCDE6D6'),
  });
  ['员工姓名', '工号', '净应出勤', '实际出勤', '加班', '出勤得分'].forEach((header, index) => {
    setMergedCell(sheet, summaryHeaderRow, summarySpans[index][0], summarySpans[index][1], header, {
      font: { name: 'Microsoft YaHei', size: 9.5, bold: true, color: { argb: EXCEL_THEME.paper } },
      fill: EXCEL_THEME.green,
      alignment: { horizontal: 'center', vertical: 'middle' },
      border: border('FF2E6F48'),
    });
  });
  employeeTotals.forEach((summary, index) => {
    const row = summaryDataStart + index;
    const sourceRow = BODY_START_ROW + index;
    const sourceColumns = [2, 3, plannedColumn, actualColumn, overtimeColumn, rateColumn];
    sourceColumns.forEach((sourceColumn, columnIndex) => {
      const cell = setMergedCell(sheet, row, summarySpans[columnIndex][0], summarySpans[columnIndex][1], {
        formula: `${excelColumnName(sourceColumn)}${sourceRow}`,
        result: columnIndex === 0 ? summary.employee.name : columnIndex === 1 ? summary.employee.employeeNo : columnIndex === 2 ? summary.expected : columnIndex === 3 ? summary.actual : columnIndex === 4 ? summary.overtime : summary.rate ?? '',
      }, {
        numFmt: columnIndex === 5 ? '0.0%' : columnIndex >= 2 ? '#,##0.0' : '@',
        font: { name: 'Microsoft YaHei', size: 9, color: { argb: EXCEL_THEME.ink }, bold: columnIndex === 0 },
        fill: index % 2 ? 'FFF8FAFC' : EXCEL_THEME.paper,
        alignment: { horizontal: columnIndex >= 2 ? 'right' : 'left', vertical: 'middle' },
        border: border(EXCEL_THEME.softLine),
      });
      if (columnIndex >= 2) cell.numFmt = columnIndex === 5 ? '0.0%' : '#,##0.0';
    });
    sheet.getRow(row).height = 21;
  });

  const trend = await renderAttendanceTrend(input.dateKeys, dailyTotals, dailyTotals.map((value, index) => dailyPeople[index] ? value / dailyPeople[index] : 0));
  const overtimeChart = await renderOvertimeRanking(employeeTotals.map(row => ({ name: row.employee.name, overtime: row.overtime })));
  const trendImage = workbook.addImage({ base64: `data:image/png;base64,${trend.toString('base64')}`, extension: 'png' });
  const overtimeImage = workbook.addImage({ base64: `data:image/png;base64,${overtimeChart.toString('base64')}`, extension: 'png' });
  const summaryRows = Math.max(4, input.employees.length + 2);
  let contentEndRow: number;
  if (totalColumns >= 34) {
    const overtimeStart = Math.max(summaryColumnCount + 11, totalColumns - 10);
    const trendWidth = Math.max(340, (overtimeStart - summaryColumnCount - 1) * 34);
    const overtimeWidth = Math.max(260, (totalColumns - overtimeStart) * 34);
    sheet.addImage(trendImage, { tl: { col: summaryColumnCount + 0.25, row: summaryTitleRow - 1 }, ext: { width: trendWidth, height: 265 }, editAs: 'oneCell' });
    sheet.addImage(overtimeImage, { tl: { col: overtimeStart + 0.1, row: summaryTitleRow - 1 }, ext: { width: overtimeWidth, height: 265 }, editAs: 'oneCell' });
    contentEndRow = Math.max(summaryDataStart + input.employees.length, summaryTitleRow + 14);
  } else {
    const chartStartRow = summaryDataStart + summaryRows;
    sheet.addImage(trendImage, { tl: { col: 0, row: chartStartRow - 1 }, ext: { width: 820, height: 250 }, editAs: 'oneCell' });
    sheet.addImage(overtimeImage, { tl: { col: 0, row: chartStartRow + 13 }, ext: { width: 520, height: 250 }, editAs: 'oneCell' });
    contentEndRow = chartStartRow + 27;
  }

  const notes = [
    '1. 每日单元格记录已确认实际出勤小时，数值中包含已确认加班；草稿与未登记数据不进入正式汇总。周休和节假日整日剔除。',
    '2. 净应出勤＝排班常规工时＋已确认实际加班－已确认请假；实际出勤已含加班，不重复相加。',
    '3. 出勤得分＝实际出勤÷净应出勤并封顶 100%；整日请假与休息剔除基数，部分请假缩减基数，超额出勤不再推高得分。',
    '4. 周一至周六默认工作、周日默认周休；临时周末工作只有先在出勤日历启用后才统计。正式缺勤保留在出勤基数；未入职、草稿和未登记不按 0 计算。',
  ];
  let noteRow = contentEndRow + 1;
  setMergedCell(sheet, noteRow, 1, totalColumns, '统计说明', {
    font: { name: 'Microsoft YaHei', size: 11, bold: true, color: { argb: EXCEL_THEME.green } },
    fill: EXCEL_THEME.greenSoft,
    alignment: { horizontal: 'left', vertical: 'middle', indent: 1 },
    border: border('FFCDE6D6'),
  });
  notes.forEach(note => {
    noteRow += 1;
    setMergedCell(sheet, noteRow, 1, totalColumns, note, {
      font: { name: 'Microsoft YaHei', size: 9, color: { argb: EXCEL_THEME.muted } },
      fill: EXCEL_THEME.paper,
      alignment: { horizontal: 'left', vertical: 'middle', indent: 1, wrapText: true },
      border: border(EXCEL_THEME.softLine),
    });
    sheet.getRow(noteRow).height = 22;
  });

  [6, 14, 12, 14, 13].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  input.dateKeys.forEach((_, index) => { sheet.getColumn(IDENTITY_COLUMN_COUNT + index + 1).width = 5.2; });
  [13, 13, 12, 11].forEach((width, index) => { sheet.getColumn(plannedColumn + index).width = width; });

  sheet.views = [{
    state: 'frozen',
    xSplit: IDENTITY_COLUMN_COUNT,
    ySplit: MAIN_HEADER_ROW,
    topLeftCell: `${excelColumnName(IDENTITY_COLUMN_COUNT + 1)}${BODY_START_ROW}`,
    activeCell: `A${BODY_START_ROW}`,
    showGridLines: false,
    zoomScale: input.dateKeys.length > 20 ? 80 : 90,
  }];
  sheet.autoFilter = {
    from: { row: MAIN_HEADER_ROW, column: 1 },
    to: { row: MAIN_HEADER_ROW, column: totalColumns },
  };
  sheet.pageSetup.printArea = `A1:${lastColumnName}${noteRow}`;
  sheet.pageSetup.printTitlesRow = '1:8';
  sheet.pageSetup.printTitlesColumn = 'A:E';
  sheet.headerFooter.oddFooter = '&L杭连电子协同平台&C第 &P / &N 页&R员工出勤记录表';

  const bytes = await workbook.xlsx.writeBuffer({ useStyles: true, useSharedStrings: true });
  return {
    buffer: Buffer.from(bytes),
    employeeCount: input.employees.length,
    confirmedRecordCount,
    draftRecordCount,
    missingRecordCount,
  };
}
