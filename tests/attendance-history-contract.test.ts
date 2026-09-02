import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..');

test('attendance API returns historical roster rows without bypassing the historical record boundary', () => {
  const source = readFileSync(resolve(repositoryRoot, 'app/api/attendance/records/route.ts'), 'utf8');
  assert.match(source, /if \(employeeId && !attendanceEmployeeAllowed\(boundary, employeeId\)\)[\s\S]*boundary\.historicalRecordWhere/);
  assert.match(source, /historicalRecords\.some\(record => isEmployeeEmployedOnDate/);
  assert.match(source, /effectiveRecords\.forEach\(record => rosterById\.set\(record\.employeeId, record\.employee\)\)/);
  assert.match(source, /employees:\s*roster\.map\(serializeEmployee\)/);
});

test('departed attendance correction is atomic and keeps a reason plus before and after snapshots', () => {
  const source = readFileSync(resolve(repositoryRoot, 'app/api/attendance/records/route.ts'), 'utf8');
  assert.match(source, /historicalCorrection[\s\S]*prisma\.\$transaction/);
  assert.match(source, /action:\s*'correct_departed_employee_attendance'/);
  assert.match(source, /correctionReason,[\s\S]*before:\s*attendanceAuditSnapshot\(existing!\),[\s\S]*after:\s*attendanceAuditSnapshot\(corrected\)/);
});

test('attendance UI shows departed historical rows but excludes them from batch mutations', () => {
  const source = readFileSync(resolve(repositoryRoot, 'components/AttendanceManagementShell.tsx'), 'utf8');
  assert.match(source, /attendanceRoster\.forEach\(employee => byId\.set\(employee\.id, employee\)\)/);
  assert.match(source, /filter\(employee => employee\.isActive && employee\.attendanceEnabled\)/);
  assert.match(source, /disabled=\{!writable\}/);
  assert.match(source, /历史纠正原因（必填）/);
  assert.match(source, /已离职\$\{employee\.resignedAt/);
});

test('attendance workbook carries resignation dates and marks post-exit cells separately', () => {
  const exportSource = readFileSync(resolve(repositoryRoot, 'app/api/attendance/export.xlsx/route.ts'), 'utf8');
  const workbookSource = readFileSync(resolve(repositoryRoot, 'lib/attendance-workbook.ts'), 'utf8');
  assert.match(exportSource, /boundary\.historicalRecordWhere/);
  assert.match(exportSource, /effectiveRecords\.forEach\(record => employeeById\.set\(record\.employeeId, record\.employee\)\)/);
  assert.match(exportSource, /resignedAt:\s*employee\.resignedAt/);
  assert.match(workbookSource, /isEmployeeEmployedOnDate\(employee, dateKey\)/);
  assert.match(workbookSource, /outsideEmploymentValue = isEmployeeHiredOnDate\(employee, dateKey\) \? '离' : '未'/);
});
