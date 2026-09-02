import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createAttendanceWorkbook } from '@/lib/attendance-workbook';
import { populateBusinessReportWorkbook } from '@/lib/business-excel';

test('business report export is one compact styled worksheet', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = populateBusinessReportWorkbook(workbook, {
    title: '生产交付业务报表',
    subtitle: '生产与交付 / 数量达成率',
    period: '2026-08-17 至 2026-08-23',
    scope: '生产部',
    generatedAt: '2026-08-20 10:30',
    method: '成品数量只统计最终工序良品。',
    headers: ['日期', '计划数量', '完成数量', '数量达成率', '风险'],
    rows: [
      ['2026-08-17', 100, 90, '90.0%', '正常'],
      ['2026-08-18', 80, 20, '25.0%', '逾期'],
    ],
    kpis: [
      { label: '数量达成率', value: '61.1%', note: '最终工序良品', tone: 'orange' },
      { label: '计划数量', value: 180, note: '当前周期', tone: 'blue' },
      { label: '完成数量', value: 110, note: '当前周期', tone: 'green' },
      { label: '逾期风险', value: 1, note: '需要处理', tone: 'red' },
    ],
  });

  assert.equal(workbook.worksheets.length, 1);
  assert.equal(sheet.name, '生产交付业务报表');
  assert.equal(sheet.getCell('A1').value, '生产交付业务报表');
  assert.equal(sheet.getCell('A8').value, '日期');
  assert.equal(sheet.getCell('D9').value, 0.9);
  assert.equal(sheet.getCell('D9').numFmt, '0.0%');
  assert.match(String(sheet.getCell('E10').text), /逾期/);
  assert.equal(sheet.views[0]?.state, 'frozen');
  assert.equal(sheet.pageSetup.fitToWidth, 1);
  assert.match(sheet.pageSetup.printArea || '', /^A1:/);

  const bytes = await workbook.xlsx.writeBuffer({ useStyles: true, useSharedStrings: true });
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(bytes);
  assert.equal(reopened.worksheets.length, 1);
  assert.equal(reopened.worksheets[0].getCell('D9').value, 0.9);
});

test('attendance export follows the one-sheet employee attendance standard', async () => {
  const dateKeys = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23'];
  const result = await createAttendanceWorkbook({
    startDate: dateKeys[0],
    endDate: dateKeys[dateKeys.length - 1],
    periodLabel: '周度 · 2026-08-17 至 2026-08-23',
    scopeLabel: '生产部',
    generatedAt: '2026-08-20 10:30',
    dateKeys,
    employees: [
      { id: 'e1', employeeNo: '0001', name: '张三', department: '生产部', team: '压接', position: '压接工' },
      { id: 'e2', employeeNo: '0002', name: '李四', department: '生产部', team: '组装', position: '组装工', resignedAt: '2026-08-20' },
      { id: 'e3', employeeNo: '0003', name: '王五', department: '生产部', team: '检验', position: '检验员', hireDate: '2026-08-20' },
    ],
    records: [
      { employeeId: 'e1', dateKey: '2026-08-17', status: 'confirmed', attendanceType: 'normal', plannedMilliseconds: 8 * 3_600_000, actualMilliseconds: 10 * 3_600_000, overtimeMilliseconds: 2 * 3_600_000, leaveMilliseconds: 0, remark: null },
      { employeeId: 'e1', dateKey: '2026-08-18', status: 'confirmed', attendanceType: 'normal', plannedMilliseconds: 8 * 3_600_000, actualMilliseconds: 8 * 3_600_000, overtimeMilliseconds: 0, leaveMilliseconds: 0, remark: null },
      { employeeId: 'e1', dateKey: '2026-08-19', status: 'draft', attendanceType: 'normal', plannedMilliseconds: 8 * 3_600_000, actualMilliseconds: 8 * 3_600_000, overtimeMilliseconds: 0, leaveMilliseconds: 0, remark: '待确认' },
      { employeeId: 'e1', dateKey: '2026-08-22', status: 'confirmed', attendanceType: 'rest', plannedMilliseconds: 0, actualMilliseconds: 0, overtimeMilliseconds: 0, leaveMilliseconds: 0, remark: null },
      { employeeId: 'e2', dateKey: '2026-08-17', status: 'confirmed', attendanceType: 'absent', plannedMilliseconds: 8 * 3_600_000, actualMilliseconds: 0, overtimeMilliseconds: 0, leaveMilliseconds: 0, remark: '缺勤' },
      { employeeId: 'e2', dateKey: '2026-08-18', status: 'confirmed', attendanceType: 'leave', plannedMilliseconds: 8 * 3_600_000, actualMilliseconds: 0, overtimeMilliseconds: 0, leaveMilliseconds: 8 * 3_600_000, remark: '请假' },
      { employeeId: 'e2', dateKey: '2026-08-20', status: 'confirmed', attendanceType: 'normal', plannedMilliseconds: 8 * 3_600_000, actualMilliseconds: 8 * 3_600_000, overtimeMilliseconds: 0, leaveMilliseconds: 0, remark: '离职日异常遗留记录' },
    ],
  });

  assert.equal(result.employeeCount, 3);
  assert.equal(result.confirmedRecordCount, 5);
  assert.equal(result.draftRecordCount, 1);
  assert.equal(result.missingRecordCount, 6);

  const workbook = new ExcelJS.Workbook();
  const workbookBytes = result.buffer.buffer.slice(
    result.buffer.byteOffset,
    result.buffer.byteOffset + result.buffer.byteLength,
  ) as ArrayBuffer;
  await workbook.xlsx.load(workbookBytes);
  assert.equal(workbook.worksheets.length, 1);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.name, '员工出勤记录表');
  assert.equal(sheet.getCell('A1').value, '员工出勤记录表（小时制）');
  assert.equal(sheet.getCell('F9').value, 10);
  assert.equal(sheet.getCell('F10').value, '缺');
  assert.equal(sheet.getCell('G10').value, '假');
  assert.equal(sheet.getCell('I10').value, '离');
  assert.equal(sheet.getCell('H9').value, '待');
  assert.equal(sheet.getCell('K9').value, '休');
  assert.equal(sheet.getCell('L9').value, '周休');
  assert.equal(sheet.getCell('L10').value, '离');
  assert.equal(sheet.getCell('L11').value, '周休');
  assert.equal(sheet.getCell('F11').value, '未');
  assert.equal(sheet.getCell('H11').value, '未');
  assert.equal((sheet.getCell('N9').value as ExcelJS.CellFormulaValue).formula, 'SUM(F9:L9)');
  assert.equal((sheet.getCell('P9').value as ExcelJS.CellFormulaValue).result, 1);
  assert.equal(sheet.getCell('P9').numFmt, '0.0%');
  assert.equal(sheet.getImages().length, 2);
  assert.equal(sheet.views[0]?.state, 'frozen');
  assert.equal(sheet.views[0]?.xSplit, 5);
  assert.equal(sheet.pageSetup.fitToWidth, 1);
  assert.match(sheet.pageSetup.printArea || '', /^A1:P/);
});
