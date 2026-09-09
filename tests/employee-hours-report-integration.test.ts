import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { loadEmployeeHoursReport } from '../lib/employee-hours-report-service';
import { employeeHoursOperationsRows } from '../lib/employee-hours-operations';
import { employeeReportRange } from '../lib/process-time';
import { reportRangeDateKeys } from '../lib/report-date-range';
import { employeeAttainmentDetails } from '../lib/employee-attainment-details';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
const hour = 3_600_000;
test('employee facts reconcile pending labor, rest days, historical eligibility, missing attendance and operations', { skip: !enabled }, async () => {
  const target = new URL(process.env.DATABASE_URL || '');
  assert.equal(target.protocol, 'postgresql:');
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname), 'Integration tests require a loopback database');
  const localTestDatabase = target.port === '55442'
    && /^\/hongmeng_employee_hours_v134142_(report|ci)$/.test(target.pathname);
  const githubTestDatabase = (target.port || '5432') === '5432'
    && target.pathname === '/hongmeng_ci' && process.env.CI === 'true';
  assert.ok(localTestDatabase || githubTestDatabase, 'Only the dedicated local report/CI database or named GitHub CI database is allowed');
  const marker = `IT-HOURS-${randomUUID().slice(0, 8)}`;
  const actor = await prisma.user.create({ data: { username: marker, displayName: marker, passwordHash: 'isolated-test' } });
  const employees = await Promise.all([0, 1].map(index => prisma.employee.create({ data: {
    employeeNo: `${marker}-${index}`, name: `${marker}-${index}`, department: '生产部', team: marker,
    hireDate: new Date('2026-09-06T00:00:00Z'), attendanceEnabled: true,
    attainmentEligible: index === 1, attainmentStream: index === 0 ? 'excluded' : 'batch', attainmentFactorBasisPoints: 0,
  } })));
  const order = await prisma.workOrder.create({ data: {
    code: marker, productName: '隔离报表产品', stage: 'backend', processRoute: { create: { templateName: marker, templateVersion: 1,
      steps: { create: { processCode: marker, processName: '后工序', stageGroup: 'backend', position: 1 } },
    } },
  }, include: { processRoute: { include: { steps: true } } } });
  const route = order.processRoute!;
  const step = route.steps[0];
  const ids = employees.map(employee => employee.id);
  const eventIds: string[] = [];
  async function attendance(index: number, date: string, actual: number, overtime = 0) {
    return prisma.attendanceRecord.create({ data: {
      employeeId: ids[index], workDate: new Date(`${date}T00:00:00Z`), status: 'confirmed', attendanceType: 'normal',
      actualMilliseconds: actual * hour, overtimeMilliseconds: overtime * hour, plannedMilliseconds: (actual - overtime) * hour,
      segments: [], departmentSnapshot: '生产部', teamSnapshot: marker,
      attainmentEligibleSnapshot: true, attainmentStreamSnapshot: 'batch', attainmentFactorBasisPointsSnapshot: 0,
    } });
  }
  async function claim(index: number, date: string, hours: number, voided = false, countsForEfficiency = true) {
    const completion = await prisma.processCompletion.create({ data: {
      workOrderId: order.id, routeId: route.id, stepId: step.id, workDate: new Date(`${date}T00:00:00Z`),
      completedAt: new Date(`${date}T09:00:00+08:00`), processedQty: 1, goodQty: 1, defectQty: 0,
      reportedUnitQty: 1, reportedGoodUnitQty: 1, reportedDefectUnitQty: 0,
      countsForEfficiency,
      routeVersion: 0, idempotencyKey: randomUUID(), standardSource: 'integration', coverageStatus: 'PENDING',
      laborPool: { create: {
        workOrderId: order.id, stepId: step.id, workDate: new Date(`${date}T00:00:00Z`),
        eligibleQty: 1, claimedQty: 1, remainingQty: 0, standardMillisecondsPerUnit: hours * hour,
        totalStandardLaborMilliseconds: BigInt(hours * hour), claimedStandardLaborMilliseconds: BigInt(hours * hour),
        remainingStandardLaborMilliseconds: 0n, standardSource: 'integration',
        countsForEfficiency,
        claims: { create: { employeeId: ids[index], quantity: 1, standardLaborMilliseconds: BigInt(hours * hour),
          workDate: new Date(`${date}T00:00:00Z`), idempotencyKey: randomUUID(), status: voided ? 'VOIDED' : 'ACTIVE',
          ...(voided ? { voidedAt: new Date(), voidedById: actor.id, voidReason: 'isolated test' } : {}) } },
      } },
    }, include: { laborPool: { include: { claims: true } } } });
    return completion;
  }
  const range = employeeReportRange('custom', '2026-09-06', '2026-09-06', '2026-09-09');
  const load = () => loadEmployeeHoursReport({ ...range, period: 'custom', employeeIdConstraint: { in: ids }, now: new Date('2026-09-08T12:00:00+08:00') });
  try {
    await attendance(0, '2026-09-06', 10, 2);
    await attendance(0, '2026-09-07', 5);
    await claim(0, '2026-09-06', 8);
    await claim(0, '2026-09-07', 6);
    await claim(0, '2026-09-07', 3, false, false);
    await claim(0, '2026-09-09', 100);
    await attendance(0, '2026-09-09', 8);
    await claim(0, '2026-09-07', 100, true);
    const missingClaim = await claim(1, '2026-09-07', 2);
    for (const qualityStatus of ['confirmed', 'pending', 'rejected']) {
      const event = await prisma.abnormalTimeEvent.create({ data: {
        workDate: new Date('2026-09-06T00:00:00Z'), category: 'equipment_tooling', title: marker,
        durationMilliseconds: hour, employeeExempt: true, qualityStatus,
        allocations: { create: { employeeId: ids[0], workDate: new Date('2026-09-06T00:00:00Z'), durationMilliseconds: hour } },
      } });
      eventIds.push(event.id);
    }
    const { report } = await load();
    const main = report.rows.find(row => row.employee.id === ids[0])!;
    const missing = report.rows.find(row => row.employee.id === ids[1])!;
    assert.equal(main.attendanceMilliseconds, 15 * hour);
    assert.equal(main.standardLaborMilliseconds, 14 * hour);
    assert.equal(employeeAttainmentDetails(main).reduce((sum, detail) => sum + detail.standardLaborMilliseconds, 0), 14 * hour);
    assert.equal(employeeAttainmentDetails(main).reduce((sum, detail) => sum + detail.recordedLaborMilliseconds, 0), 17 * hour);
    assert.equal(main.claimDetails.filter(detail => detail.countsForEfficiency === false).length, 1);
    assert.equal(main.exemptAbnormalMilliseconds, hour);
    assert.equal(main.regularAttendanceMilliseconds, 13 * hour);
    assert.equal(main.attainmentBasisPoints, 9967);
    assert.equal(main.days.find(day => day.date === '2026-09-06')!.targetAttainmentBasisPoints, 8950);
    assert.equal(main.days.find(day => day.date === '2026-09-07')!.targetAttainmentBasisPoints, 12000);
    assert.equal(main.days.find(day => day.date === '2026-09-09')!.standardLaborMilliseconds, 0);
    assert.equal(main.actualLaborMilliseconds, 0);
    assert.equal(main.processEfficiencyBasisPoints, null);
    assert.equal(main.attainmentStream, 'batch', 'Historical batch snapshot survives current excluded employee policy');
    assert.equal(missing.standardLaborMilliseconds, 2 * hour);
    assert.equal(missing.unmatchedStandardLaborMilliseconds, 0);
    assert.equal(missing.attainmentBasisPoints, null);
    assert.equal(missing.attainmentDataComplete, false);
    assert.equal(report.summary.standardLaborMilliseconds, 16 * hour);
    assert.equal(report.summary.attainmentBasisPoints, null);
    const operations = employeeHoursOperationsRows(report.rows, reportRangeDateKeys(range.start, range.end));
    for (const row of report.rows) {
      const matrix = operations.find(item => item.employee.id === row.employee.id)!;
      for (const key of ['standardLaborMilliseconds', 'attendanceMilliseconds', 'exemptAbnormalMilliseconds', 'attainmentBasisPoints', 'attainmentIncompleteDays', 'attainmentNumeratorMilliseconds'] as const) assert.equal(matrix[key], row[key], key);
      for (const day of row.days) {
        const matrixDay = matrix.days.find(item => item.date === day.date)!;
        assert.equal(matrixDay.standardLaborMilliseconds, day.standardLaborMilliseconds);
        assert.equal(matrixDay.attainmentBasisPoints, day.targetAttainmentBasisPoints);
      }
    }
    // Filling predecessor coverage changes a relation, never the original day's credit.
    await prisma.processCompletion.update({ where: { id: missingClaim.id }, data: { coverageStatus: 'COVERED' } });
    await attendance(1, '2026-09-07', 8);
    const after = (await load()).report.rows.find(row => row.employee.id === ids[1])!;
    assert.equal(after.standardLaborMilliseconds, 2 * hour);
    assert.equal(after.days.find(day => day.date === '2026-09-07')!.targetAttainmentBasisPoints, 2500);
    await prisma.processLaborClaim.update({ where: { id: missingClaim.laborPool!.claims[0].id }, data: { status: 'VOIDED', voidedAt: new Date(), voidedById: actor.id } });
    assert.equal((await load()).report.rows.find(row => row.employee.id === ids[1])!.standardLaborMilliseconds, 0);
  } finally {
    await prisma.abnormalTimeEvent.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.processLaborClaim.deleteMany({ where: { employeeId: { in: ids } } });
    await prisma.processLaborPool.deleteMany({ where: { workOrderId: order.id } });
    await prisma.processCompletion.deleteMany({ where: { workOrderId: order.id } });
    await prisma.workOrder.delete({ where: { id: order.id } });
    await prisma.attendanceRecord.deleteMany({ where: { employeeId: { in: ids } } });
    await prisma.employee.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.delete({ where: { id: actor.id } });
    await prisma.$disconnect();
  }
});
