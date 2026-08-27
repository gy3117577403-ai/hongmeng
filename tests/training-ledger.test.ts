import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { parseTrainingDateTime } from '../lib/training';
import { trainingLedgerFilter } from '../lib/training-ledger';
import { parseTrainingLocalTime, trainingDateTimeInput, trainingExcelDate, trainingMonthRange } from '../lib/training-time';
import { createTrainingWorkbook, trainingWorkbookOutcome, type TrainingWorkbookRow } from '../lib/training-workbook';

test('training local inputs and Excel wall clocks are independent from process timezone and do not mutate facts', () => {
  const previous = process.env.TZ;
  try {
    for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Shanghai']) {
      process.env.TZ = tz;
      const fact = new Date('2026-08-24T08:30:45Z');
      assert.equal(trainingDateTimeInput(fact), '2026-08-24T16:30');
      assert.equal(trainingExcelDate(fact).toISOString(), '2026-08-24T16:30:45.000Z');
      assert.equal(fact.toISOString(), '2026-08-24T08:30:45.000Z');
      assert.equal(parseTrainingLocalTime('2026-08-24T16:30').toISOString(), '2026-08-24T08:30:00.000Z');
      assert.equal(parseTrainingDateTime('2026-08-24T16:30', '开始时间').toISOString(), '2026-08-24T08:30:00.000Z');
      assert.equal(parseTrainingDateTime('2026-08-24T08:30:00.000Z', '开始时间').toISOString(), '2026-08-24T08:30:00.000Z');
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('training date filters include the complete final Beijing day and reject rolled dates', () => {
  const result = trainingLedgerFilter(new URLSearchParams('period=custom&startDate=2026-08-24&endDate=2026-08-24'));
  assert.equal(result.range?.start.toISOString(), '2026-08-23T16:00:00.000Z');
  assert.equal(result.range?.end.toISOString(), '2026-08-24T16:00:00.000Z');
  assert.equal(result.where.status, 'COMPLETED');
  assert.equal(result.where.deletedAt, null);
  assert.throws(() => trainingLedgerFilter(new URLSearchParams('period=custom&startDate=2026-02-30&endDate=2026-03-01')));
  assert.throws(() => trainingLedgerFilter(new URLSearchParams('period=custom&startDate=2026-08-25&endDate=2026-08-24')));
  assert.throws(() => parseTrainingLocalTime('2026-02-29T12:00'));
  assert.throws(() => parseTrainingLocalTime('2026-08-24T24:00'));
  assert.deepEqual(trainingMonthRange(new Date('2028-02-01T00:00:00Z')), { start: '2028-02-01', end: '2028-02-29' });
  assert.deepEqual(trainingMonthRange(new Date('2026-08-31T16:00:00Z')), { start: '2026-09-01', end: '2026-09-30' });
});

const row: TrainingWorkbookRow = {
  planCode: 'TRP-EXCEL', planStatus: 'COMPLETED', planTitle: '报工培训', courseName: '',
  startAt: new Date('2026-08-24T08:30:00Z'), endAt: new Date('2026-08-24T09:00:00Z'),
  employeeNo: '000123', employeeName: '台账测试员', department: '品质部', team: null, position: null,
  attendanceStatus: 'PRESENT', actualMinutes: 30, assessmentMode: 'NONE', theoryScore: null,
  practicalScore: null, score: null, result: 'PENDING', reviewStatus: 'NOT_REQUIRED', certificationId: null,
};

test('ordinary ledger has a first-row header, one sheet, real numbers, leading zeros and blank unrecorded facts', async () => {
  const workbook = new ExcelJS.Workbook();
  const bytes = await createTrainingWorkbook({ startDate: '2026-08-24', endDate: '2026-08-24', generatedAt: '2026-08-28 10:00', rows: [
    row, { ...row, attendanceStatus: 'ABSENT', actualMinutes: null, assessmentMode: 'THEORY', reviewStatus: 'PENDING' },
    { ...row, score: 0, assessmentMode: 'THEORY', reviewStatus: 'APPROVED', result: 'FAILED' },
  ] });
  await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
  assert.equal(workbook.worksheets.length, 1);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.rowCount, 4); assert.equal(sheet.columnCount, 15);
  assert.equal(sheet.getCell('A1').value, '序号'); assert.equal(sheet.getCell('A1').isMerged, false);
  assert.equal(sheet.getCell('H2').value, '000123'); assert.equal(sheet.getCell('H2').numFmt, '@');
  assert.equal(sheet.getCell('J2').value, 0.5);
  assert.equal(sheet.getCell('J3').value, null); assert.equal(sheet.getCell('L3').value, null);
  assert.equal(sheet.getCell('L4').value, 0); assert.equal(sheet.getCell('M4').value, '不合格');
  assert.equal((sheet.getCell('D2').value as Date).toISOString(), '2026-08-24T16:30:00.000Z');
  assert.equal((sheet.getCell('E2').value as Date).toISOString(), '2026-08-24T17:00:00.000Z');
  assert.equal(sheet.autoFilter, 'A1:O4'); assert.equal(sheet.views[0].state, 'frozen');
  const empty = new ExcelJS.Workbook();
  await empty.xlsx.load(Uint8Array.from(await createTrainingWorkbook({ startDate: '', endDate: '', generatedAt: '', rows: [] })).buffer);
  assert.equal(empty.worksheets[0].rowCount, 1);
});

test('no-assessment never turns absence, cancellation or a draft into completion', () => {
  assert.equal(trainingWorkbookOutcome(row), '完成（无需考核）');
  for (const attendanceStatus of ['INVITED', 'ABSENT', 'PARTIAL', 'LEAVE']) assert.equal(trainingWorkbookOutcome({ ...row, attendanceStatus }), '未完成');
  assert.equal(trainingWorkbookOutcome({ ...row, planStatus: 'DRAFT' }), '未完成');
  assert.equal(trainingWorkbookOutcome({ ...row, planStatus: 'CANCELLED' }), '已取消');
  assert.equal(trainingWorkbookOutcome({ ...row, assessmentMode: 'THEORY', reviewStatus: 'RETURNED' }), '已退回');
});
