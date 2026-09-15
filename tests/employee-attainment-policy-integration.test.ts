import { deleteTestCompletions } from './helpers/delete-test-completions';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { previewEmployeeAttainmentChange, applyEmployeeAttainmentChange, employeePolicyOnDate } from '../lib/employee-attainment-policy-service';
import { employeeAttainmentPolicy } from '../lib/employee-attainment-policy';
import { loadEmployeeHoursReport } from '../lib/employee-hours-report-service';
import { employeeReportRange } from '../lib/process-time';

test('sample to production updates dated facts atomically, preserves exceptions and reconciles day week month with other hours', { skip: process.env.RUN_DB_INTEGRATION !== '1' }, async () => {
  const db = new URL(process.env.DATABASE_URL || '');
  assert(['localhost', '127.0.0.1'].includes(db.hostname));
  assert((db.port === '25483' && db.pathname === '/hongmeng_hours183') || (db.port === '55448' && db.pathname === '/hongmeng_attainment_transfer_v134150') || (process.env.CI === 'true' && db.pathname === '/hongmeng_ci'));
  const tag = 'POLICY-' + randomUUID().slice(0, 8), h = 3600000;
  const date = (s: string) => new Date(s + 'T00:00:00Z');
  const actor = await prisma.user.create({ data: { username: tag, displayName: tag, passwordHash: 'isolated-test' } });
  let employee = await prisma.employee.create({ data: { employeeNo: tag, name: tag, department: '生产部', team: '样品组',
    attainmentStream: 'sample', attainmentEligible: true, hireDate: date('2026-07-01') } });
  const team = await prisma.productionTeam.create({ data: { code: tag, name: tag + '装配' } });
  const lead = await prisma.user.create({ data: { username: tag + '-lead', displayName: tag, passwordHash: 'isolated-test',
    accessGrants: { create: { profile: 'WORKSHOP_TEAM_LEADER', scopeKey: 'TEAM:' + team.id, grantType: 'PRIMARY' } } } });
  const order = await prisma.workOrder.create({ data: { code: tag, productName: tag, stage: 'backend', processRoute: { create: {
    templateName: tag, templateVersion: 1, steps: { create: { processCode: tag, processName: tag, stageGroup: 'backend', position: 1 } },
  } } }, include: { processRoute: { include: { steps: true } } } });
  const route = order.processRoute!, step = route.steps[0];
  const category = await prisma.otherWorkTimeCategory.create({ data: { name: tag, code: tag } });
  const lossIds: string[] = [];
  const load = async (period: 'today' | 'week' | 'month', anchor: string) => {
    const range = employeeReportRange(period, anchor);
    return (await loadEmployeeHoursReport({ ...range, period, employeeIdConstraint: employee.id, now: new Date('2026-09-10T12:00:00+08:00') })).report.rows.find(row => row.employee.id === employee.id)!;
  };
  async function credit(day: string, hours: number) {
    await prisma.processCompletion.create({ data: { workOrderId: order.id, routeId: route.id, stepId: step.id, workDate: date(day),
      completedAt: new Date(day + 'T09:00:00+08:00'), processedQty: 1, goodQty: 1, defectQty: 0, reportedUnitQty: 1, reportedGoodUnitQty: 1,
      reportedDefectUnitQty: 0, routeVersion: 0, idempotencyKey: randomUUID(), standardSource: 'test', coverageStatus: 'PENDING',
      laborPool: { create: { workOrderId: order.id, stepId: step.id, workDate: date(day), eligibleQty: 1, claimedQty: 1, remainingQty: 0,
        standardMillisecondsPerUnit: hours * h, totalStandardLaborMilliseconds: BigInt(Math.round(hours * h)), claimedStandardLaborMilliseconds: BigInt(Math.round(hours * h)),
        remainingStandardLaborMilliseconds: 0n, standardSource: 'test', claims: { create: { employeeId: employee.id, quantity: 1,
          standardLaborMilliseconds: BigInt(Math.round(hours * h)), workDate: date(day), idempotencyKey: randomUUID(), status: 'ACTIVE' } } } },
    } });
  }
  try {
    for (const day of ['2026-07-31', '2026-08-01', '2026-08-02', '2026-08-03']) {
      await prisma.attendanceRecord.create({ data: { employeeId: employee.id, workDate: date(day), departmentSnapshot: '生产部', teamSnapshot: '样品组',
        attainmentStreamSnapshot: 'sample', attainmentEligibleSnapshot: true, attainmentFactorBasisPointsSnapshot: 10000,
        status: 'confirmed', actualMilliseconds: day.endsWith('02') ? 8 * h : 10.5 * h, overtimeMilliseconds: day.endsWith('02') ? 0 : 2.5 * h,
        plannedMilliseconds: 8 * h, segments: [], attainmentPolicyOverride: day.endsWith('03'), attainmentPolicyReason: day.endsWith('03') ? '当日仍协助样品' : null } });
    }
    // Other tests may have opened additional plant dates. Explicit zero-hour rest records keep this fixture independent.
    await prisma.attendanceRecord.createMany({ data: Array.from({ length: 28 }, (_, index) => ({ employeeId: employee.id,
      workDate: date('2026-08-' + String(index + 4).padStart(2, '0')), departmentSnapshot: '生产部', teamSnapshot: '样品组',
      attainmentStreamSnapshot: 'sample', attainmentEligibleSnapshot: true, attainmentFactorBasisPointsSnapshot: 10000,
      status: 'confirmed', attendanceType: 'rest', actualMilliseconds: 0, overtimeMilliseconds: 0, plannedMilliseconds: 0, segments: [] })) });
    await credit('2026-07-31', 7.31); await credit('2026-08-01', 7.31); await credit('2026-08-02', 6);
    const loss = await prisma.abnormalTimeEvent.create({ data: { workDate: date('2026-08-01'), category: 'equipment_tooling', title: tag,
      durationMilliseconds: .5 * h, employeeExempt: true, qualityStatus: 'confirmed', allocations: { create: { employeeId: employee.id, workDate: date('2026-08-01'), durationMilliseconds: .5 * h } } } });
    lossIds.push(loss.id);
    await prisma.otherWorkTimeRequest.create({ data: { employeeId: employee.id, createdById: actor.id, employeeNameSnapshot: tag, employeeNoSnapshot: tag,
      teamSnapshot: '样品组', attainmentEligibleSnapshot: true, attainmentStreamSnapshot: 'sample', categoryId: category.id, categoryNameSnapshot: tag,
      workDate: date('2026-08-02'), requestedMinutes: 120, approvedMinutes: 120, status: 'APPROVED', reviewedAt: new Date(), description: tag,
      idempotencyKey: randomUUID(), requestHash: tag } });
    assert.equal((await load('today', '2026-08-01')).attainmentBasisPoints, null);
    const pending = await prisma.otherWorkTimeRequest.create({ data: { employeeId: employee.id, createdById: actor.id, employeeNameSnapshot: tag, employeeNoSnapshot: tag,
      teamSnapshot: '样品组', attainmentEligibleSnapshot: true, attainmentStreamSnapshot: 'sample', categoryId: category.id, categoryNameSnapshot: tag,
      workDate: date('2026-08-02'), requestedMinutes: 30, status: 'PENDING', submittedAt: new Date(), description: tag + 'pending',
      idempotencyKey: randomUUID(), requestHash: tag } });
    // Reproduce the incident: the current profile was already changed, while daily snapshots still say sample.
    employee = await prisma.employee.update({ where: { id: employee.id }, data: { team: team.name, attainmentStream: 'batch' } });
    const target = employeeAttainmentPolicy(employee);
    const body: Record<string, unknown> = { attainmentChange: { effectiveDate: '2026-08-01', reason: '8月起正式调入量产' } };
    let preview = await previewEmployeeAttainmentChange(employee, target, body);
    assert.equal(preview.attendanceCount, 30); assert.equal(preview.preservedOverrideCount, 1); assert.equal(preview.otherWorkCount, 2);
    assert.equal(preview.priorPolicy.attainmentStream, 'sample'); assert.equal(preview.priorPolicySource, '2026-07-31');
    const august = await prisma.attendanceRecord.findFirstOrThrow({ where: { employeeId: employee.id, workDate: date('2026-08-01') } });
    await prisma.attendanceRecord.update({ where: { id: august.id }, data: { remark: '并发编辑考勤' } });
    const update = { team: target.team, attainmentStream: target.attainmentStream, attainmentEligible: true };
    const staleBody = { ...body, attainmentChange: { ...(body.attainmentChange as object), token: preview.token, requestId: randomUUID() } };
    await assert.rejects(() => applyEmployeeAttainmentChange(employee.id, actor.id, target, staleBody, update), /重新预览/);
    assert.equal(await prisma.employeeAttainmentPolicyChange.count({ where: { employeeId: employee.id } }), 0);
    preview = await previewEmployeeAttainmentChange(employee, target, body);
    const appliedBody = { ...body, attainmentChange: { ...(body.attainmentChange as object), token: preview.token, requestId: randomUUID() } };
    await applyEmployeeAttainmentChange(employee.id, actor.id, target, appliedBody, update);
    await applyEmployeeAttainmentChange(employee.id, actor.id, target, appliedBody, update);
    await assert.rejects(() => applyEmployeeAttainmentChange(employee.id, actor.id, target, { ...appliedBody, name: 'changed-after-review' }, update), /其他变更/);
    assert.equal(await prisma.employeeAttainmentPolicyChange.count({ where: { employeeId: employee.id } }), 1);
    assert.equal(await prisma.otherWorkTimeReview.count({ where: { requestId: pending.id, action: 'POLICY_CHANGE' } }), 1);
    const pendingAfter = await prisma.otherWorkTimeRequest.findUniqueOrThrow({ where: { id: pending.id } });
    assert.equal(pendingAfter.status, 'PENDING'); assert.equal(pendingAfter.teamIdSnapshot, team.id);
    assert.equal(await prisma.systemNotificationRecipient.count({ where: { userId: lead.id, notification: { sourceId: pending.id, eventType: 'other_work_policy_change' } } }), 1);
    assert.equal((await load('today', '2026-07-31')).attainmentBasisPoints, null);
    assert.equal((await load('today', '2026-08-01')).attainmentBasisPoints, 7830);
    assert.equal((await load('today', '2026-08-02')).attainmentBasisPoints, 11184);
    assert.equal((await load('today', '2026-08-03')).attainmentBasisPoints, null);
    const expected = Math.round((7.81 + 8.5) / ((10.5 + 8) * .95) * 10000);
    assert.equal((await load('week', '2026-08-01')).attainmentBasisPoints, expected);
    assert.equal((await load('month', '2026-08-01')).attainmentBasisPoints, expected);
    const unchanged = await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: august.id } });
    assert.equal(unchanged.actualMilliseconds, august.actualMilliseconds); assert.equal(unchanged.overtimeMilliseconds, august.overtimeMilliseconds);
    assert.equal(unchanged.status, 'confirmed'); assert.equal(unchanged.confirmedAt?.getTime(), august.confirmedAt?.getTime());
    const nowEmployee = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    assert.equal((await employeePolicyOnDate(prisma, nowEmployee, '2026-07-30')).policy.attainmentStream, 'sample');
    assert.equal((await employeePolicyOnDate(prisma, nowEmployee, '2026-08-31')).policy.attainmentStream, 'batch');
    const nextTarget = employeeAttainmentPolicy({ ...nowEmployee, attainmentStream: 'sample' });
    const nextBody = { attainmentChange: { effectiveDate: '2026-09-01', reason: '再次调回样品' } };
    const nextPreview = await previewEmployeeAttainmentChange(nowEmployee, nextTarget, nextBody);
    await applyEmployeeAttainmentChange(employee.id, actor.id, nextTarget, { ...nextBody, attainmentChange: { ...nextBody.attainmentChange, token: nextPreview.token, requestId: randomUUID() } }, { attainmentStream: 'sample' });
    assert.equal((await load('month', '2026-08-01')).attainmentBasisPoints, expected);
    const current = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    assert.equal((await employeePolicyOnDate(prisma, current, '2026-08-30')).policy.attainmentStream, 'batch');
    await assert.rejects(() => previewEmployeeAttainmentChange(current, target, body), /后续调岗/);
  } finally {
    const ownRequests = await prisma.otherWorkTimeRequest.findMany({ where: { employeeId: employee.id }, select: { id: true } });
    const ids = ownRequests.map(row => row.id);
    await prisma.systemNotificationRecipient.deleteMany({ where: { notification: { sourceId: { in: ids } } } });
    await prisma.systemNotification.deleteMany({ where: { sourceId: { in: ids } } });
    await prisma.otherWorkTimeReview.deleteMany({ where: { requestId: { in: ids } } });
    await prisma.otherWorkTimeRequest.deleteMany({ where: { employeeId: employee.id } });
    await prisma.otherWorkTimeCategory.delete({ where: { id: category.id } });
    await prisma.employeeAttainmentPolicyChange.deleteMany({ where: { employeeId: employee.id } });
    await prisma.abnormalTimeEvent.deleteMany({ where: { id: { in: lossIds } } });
    await prisma.processLaborClaim.deleteMany({ where: { employeeId: employee.id } });
    await prisma.processLaborPool.deleteMany({ where: { workOrderId: order.id } });
    await deleteTestCompletions({ where: { workOrderId: order.id } });
    await prisma.workOrder.delete({ where: { id: order.id } });
    await prisma.attendanceRecord.deleteMany({ where: { employeeId: employee.id } });
    await prisma.employee.delete({ where: { id: employee.id } }); await prisma.user.delete({ where: { id: actor.id } });
    await prisma.user.delete({ where: { id: lead.id } }); await prisma.productionTeam.delete({ where: { id: team.id } });
    await prisma.$disconnect();
  }
});
