/** Read-only workbook validation against the disposable hours HTTP runtime. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { populateBusinessReportWorkbook } from '../lib/business-excel';
import { EMPLOYEE_ATTAINMENT_DETAIL_HEADERS, employeeAttainmentDetailExportRows } from '../lib/employee-attainment-details';
import type { EmployeeAttainmentReportDTO } from '../types';

const hour = 3_600_000;
const hours = (value: number | null | undefined) => value == null ? null : value / hour;
const percentage = (value: number | null | undefined) => value == null ? '—' : `${(value / 100).toFixed(1)}%`;
const headers = ['员工编号', '姓名', '班组', '正常出勤（小时）', '加班（小时）', '总出勤（小时）', '完成工时（小时）', '已确认损耗（小时）', '其他工时（小时）', '目标工时（小时）', '达成率', '考勤待完善天数'];
const dayHeaders = ['日期', '员工编号', '姓名', '班组', '考勤状态', '正常出勤（小时）', '实际加班（小时）', '总出勤（小时）', '完成工时（小时）', '已确认损耗（小时）', '其他工时（小时）', '目标工时（小时）', '达成率'];

async function main() {
  const base = (process.env.HOURS_QA_BASE || '').replace(/\/+$/, '');
  const target = new URL(base);
  assert.equal(process.env.HOURS_QA_ALLOW, 'disposable-hours-runtime');
  assert.equal(target.hostname, '127.0.0.1');
  assert.ok(['3112', '3113', '3114'].includes(target.port));
  const fixtureFile = process.env.HOURS_QA_FIXTURE_FILE || '.docker/employee-hours-fixture.json';
  const fixture = JSON.parse((await readFile(fixtureFile, 'utf8')).replace(/^\uFEFF/, ''));
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: fixture.actor.username, password: process.env.HOURS_QA_PASSWORD }), signal: AbortSignal.timeout(120_000) });
  assert.equal(login.status, 200, 'fixture login');
  const cookie = login.headers.get('set-cookie')?.match(/hm_session=[^;]+/)?.[0];
  assert.ok(cookie);
  const directory = 'artifacts/employee-hours-v134142';
  await mkdir(directory, { recursive: true });
  const evidence: unknown[] = [];
  for (const period of ['today', 'week', 'month'] as const) {
    const query = new URLSearchParams({ period, date: fixture.today });
    const response: Response = await fetch(`${base}/api/reports/employee-attainment?${query}`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(120_000) });
    assert.equal(response.status, 200);
    const report: EmployeeAttainmentReportDTO = (await response.json()).report;
    const rows = report.rows.filter(row => fixture.employees.some((employee: { id: string }) => employee.id === row.employee.id));
    assert.equal(rows.length, 3, 'all fixture employees including missing attendance remain visible');
    const data = rows.map(row => [row.employee.employeeNo, row.employee.name, row.employee.team || '', hours(row.regularAttendanceMilliseconds), hours(row.recognizedOvertimeMilliseconds), hours(row.attendanceMilliseconds), hours(row.standardLaborMilliseconds), hours(row.exemptAbnormalMilliseconds), hours(row.otherWorkMilliseconds), hours(row.attainmentCapacityMilliseconds), percentage(row.attainmentBasisPoints), row.attainmentIncompleteDays]);
    const details = employeeAttainmentDetailExportRows(rows);
    const days = rows.flatMap(row => row.days.map(day => [day.date, row.employee.employeeNo, row.employee.name, row.employee.team || '', day.attendanceStatus, hours(day.regularAttendanceMilliseconds), hours(day.recognizedOvertimeMilliseconds), hours(day.attendanceMilliseconds), hours(day.standardLaborMilliseconds), hours(day.exemptAbnormalMilliseconds), hours(day.otherWorkMilliseconds), hours(day.attainmentCapacityMilliseconds), percentage(day.targetAttainmentBasisPoints)]));
    const workbook = new ExcelJS.Workbook();
    const common = { period: `${period} ${fixture.today}`, scope: '隔离验收组', generatedAt: new Date().toISOString(), method: '（完成工时 + 已确认损耗 + 其他工时）÷（出勤工时 × 0.95）；保持历史参与范围。', kpis: [] };
    populateBusinessReportWorkbook(workbook, { ...common, title: '员工工时达成业务报表', headers, rows: data });
    populateBusinessReportWorkbook(workbook, { ...common, title: '产品工序明细', headers: EMPLOYEE_ATTAINMENT_DETAIL_HEADERS, rows: details });
    populateBusinessReportWorkbook(workbook, { ...common, title: '每日工时明细', headers: dayHeaders, rows: days });
    const bytes = await workbook.xlsx.writeBuffer({ useStyles: true, useSharedStrings: true });
    const filename = `${directory}/node-export-validation-${period}.xlsx`;
    await writeFile(filename, Buffer.from(bytes));
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.readFile(filename);
    assert.equal(reopened.worksheets.length, 3);
    const [summarySheet, detailSheet, daySheet] = reopened.worksheets;
    const checked = rows.map((row, index) => {
      const excelRow = index + 9;
      for (let column = 4; column <= 10; column++) {
        assert.equal(summarySheet.getCell(excelRow, column).value, data[index][column - 1] ?? '', `${period}: numeric hour column ${column}`);
      }
      assert.equal((row.regularAttendanceMilliseconds || 0) + (row.recognizedOvertimeMilliseconds || 0), row.attendanceMilliseconds, 'overtime only included once');
      let detailTotal = 0;
      for (let i = 0; i < details.length; i++) {
        if (details[i][1] === row.employee.employeeNo) detailTotal += Number(detailSheet.getCell(i + 9, 13).value);
      }
      let dailyTotal = 0;
      for (let i = 0; i < days.length; i++) {
        if (days[i][1] === row.employee.employeeNo) dailyTotal += Number(daySheet.getCell(i + 9, 9).value);
      }
      assert.ok(Math.abs(detailTotal - row.standardLaborMilliseconds / hour) < 1e-9, 'product/process details reconcile to C');
      assert.ok(Math.abs(dailyTotal - row.standardLaborMilliseconds / hour) < 1e-9, 'day details reconcile to C');
      const expectedPercentage = row.attainmentBasisPoints == null ? '—' : Number((row.attainmentBasisPoints / 100).toFixed(1)) / 100;
      assert.equal(summarySheet.getCell(excelRow, 11).value, expectedPercentage, 'stored percentage equals displayed rate without null to zero');
      return { employeeNo: row.employee.employeeNo, attendanceHours: summarySheet.getCell(excelRow, 6).value,
        completedHours: summarySheet.getCell(excelRow, 7).value, recognizedLossHours: summarySheet.getCell(excelRow, 8).value,
        otherHours: summarySheet.getCell(excelRow, 9).value, targetHours: summarySheet.getCell(excelRow, 10).value, displayedRateValue: summarySheet.getCell(excelRow, 11).value,
        productDetailHours: detailTotal, dailyDetailHours: dailyTotal };
    });
    evidence.push({ period, filename, bytes: bytes.byteLength, sha256: createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
      sheets: reopened.worksheets.map(sheet => ({ name: sheet.name, rows: sheet.rowCount, columns: sheet.columnCount })), checked });
  }
  const output = { verifiedAt: new Date().toISOString(), base, source: 'Node generates and reopens XLSX using the same business workbook and employee detail helpers; this does not verify browser download or saving.', evidence };
  await writeFile(`${directory}/export-workbook-evidence.json`, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Workbook validation failed'); process.exitCode = 1; });
