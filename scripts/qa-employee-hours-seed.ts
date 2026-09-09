/** Synthetic fixtures for an explicitly disposable local hours runtime. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { completeProcessStep } from '../lib/process-completion-service';
import { createFieldAbnormalTimeEvent } from '../lib/field-abnormal-time-service';
import { reviewAbnormalTimeEvent } from '../lib/abnormal-time-review-service';
import { parseWorkDate, ABNORMAL_TIME_CATEGORIES } from '../lib/attendance';

const target = new URL(process.env.DATABASE_URL || '');
assert.equal(process.env.HOURS_QA_ALLOW, 'disposable-hours-runtime');
assert.equal(target.protocol, 'postgresql:');
assert.equal(target.hostname, '127.0.0.1');
const isSecondRuntime = target.port === '55443' && target.pathname === '/hongmeng_employee_hours_v134142_release_second';
const isPrimaryRuntime = target.port === '55442'
  && /^\/hongmeng_employee_hours_v134142_(dev|release(?:_(?!second$)[a-z0-9]+)?)$/.test(target.pathname);
assert.ok(isPrimaryRuntime || isSecondRuntime, 'Only the assigned disposable development/primary or second release database is allowed');
const expectedBase = `http://127.0.0.1:${isSecondRuntime ? '3114' : target.pathname.endsWith('_dev') ? '3112' : '3113'}`;
assert.equal((process.env.HOURS_QA_BASE || expectedBase).replace(/\/+$/, ''), expectedBase, 'Fixture database and HTTP runtime must belong to the same instance');
if (isSecondRuntime) assert.ok(process.env.HOURS_QA_FIXTURE_FILE, 'Second runtime requires its own fixture file');
const fixtureFile = process.env.HOURS_QA_FIXTURE_FILE || '.docker/employee-hours-fixture.json';
const password = process.env.HOURS_QA_PASSWORD!;
assert.ok(password?.length >= 16);
const hour = 3_600_000;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const yesterday = new Date(parseWorkDate(today).value.getTime() - 86_400_000).toISOString().slice(0, 10);
const marker = `HOURS-QA-${randomUUID().slice(0, 8)}`;

async function main() {
  assert.equal(await prisma.user.count({ where: { username: 'hoursqa' } }), 0, 'Fixture must only run once in a fresh QA database');
  const department = await prisma.department.upsert({ where: { code: 'PRODUCTION' }, update: {}, create: { code: 'PRODUCTION', name: '生产部' } });
  const employees = await Promise.all(['甲', '乙', '缺考勤'].map((suffix, index) => prisma.employee.create({ data: {
    employeeNo: `QA${String(index + 1).padStart(3, '0')}`, name: `工时验收${suffix}`, department: '生产部', departmentId: department.id,
    team: '隔离验收组', position: '装配操作员', hireDate: parseWorkDate(index === 2 ? today : yesterday).value,
    isActive: true, attendanceEnabled: true, attainmentEligible: true, attainmentStream: 'batch', attainmentFactorBasisPoints: 10_000,
  } })));
  const actor = await prisma.user.create({ data: { username: 'hoursqa', displayName: '工时验收管理员', employeeId: employees[0].id,
    passwordHash: await bcrypt.hash(password, 10), laborRole: 'ADMIN', mustChangePassword: false,
    accessGrants: { create: { profile: 'ADMIN_GLOBAL', departmentId: department.id, scopeKey: `GLOBAL:${marker}`, grantType: 'PRIMARY' } },
  } });
  const operator = await prisma.user.create({ data: { username: 'hoursworker', displayName: '工时验收乙', employeeId: employees[1].id,
    passwordHash: await bcrypt.hash(password, 10), laborRole: 'EMPLOYEE', mustChangePassword: false,
    accessGrants: { create: { profile: 'FIELD_REPORTER', departmentId: department.id, scopeKey: `EMPLOYEE:${employees[1].id}`, grantType: 'PRIMARY' } },
  } });
  for (const date of [yesterday, today]) {
    await prisma.attendanceCalendarDay.upsert({ where: { workDate: parseWorkDate(date).value }, update: {},
      create: { workDate: parseWorkDate(date).value, dayType: 'temporary_workday', label: '隔离工时验收工作日', updatedById: actor.id } });
  }
  for (const [employeeIndex, date, normal, overtime] of [[0, yesterday, 8, 2], [0, today, 5, 0], [1, yesterday, 8, 0], [1, today, 8, 0]] as const) {
    await prisma.attendanceRecord.create({ data: { employeeId: employees[employeeIndex].id, workDate: parseWorkDate(date).value,
      status: 'confirmed', attendanceType: 'normal', actualMilliseconds: (normal + overtime) * hour,
      overtimeMilliseconds: overtime * hour, plannedMilliseconds: normal * hour, segments: [], source: 'qa_explicit_fixture',
      departmentSnapshot: '生产部', teamSnapshot: '隔离验收组', positionSnapshot: '装配操作员',
      attainmentEligibleSnapshot: true, attainmentFactorBasisPointsSnapshot: 10_000, attainmentStreamSnapshot: 'batch',
      confirmedAt: new Date(), confirmedById: actor.id, createdById: actor.id,
    } });
  }
  async function order(kind: string, batch = false) {
    const result = await prisma.workOrder.create({ data: {
      code: `${marker}-${kind}`, customerName: '隔离验收客户', productName: batch ? '分日批次验收产品' : '扫码工时验收线束',
      specification: kind, stage: 'frontend', status: 'processing', productionTargetQty: batch ? 10 : 100,
      uncompletedQty: batch ? '10' : '100', completedQty: '0', planActive: true, planType: 'managed_plan', startedAt: new Date(),
      qrTicket: { create: { publicCode: randomUUID().replaceAll('-', '') } },
      processRoute: { create: { templateName: `${marker}-${kind}`, templateVersion: 1, version: 0, status: 'in_progress',
        reportingPolicy: 'free_sequence', routeSource: 'process_template', confirmedAt: new Date(), confirmedById: actor.id, startedAt: new Date(),
        steps: { create: [
          { processCode: `${marker}-${kind}-CUT`, processName: '前工序裁线', stageGroup: 'frontend', position: 1, sequenceGroup: 1,
            standardSource: 'qa_published_standard', timeBasis: 'per_unit', standardMillisecondsPerUnit: hour, setupMilliseconds: 0,
            unitsPerProduct: 1, unitLabel: '套', reportQuantityBasis: 'product', reportUnitLabel: '套', inputQty: batch ? 10 : 100, status: 'current', startedAt: new Date() },
          { processCode: `${marker}-${kind}-PACK`, processName: batch ? '按批装配' : '后工序装配', stageGroup: 'backend', position: 2, sequenceGroup: 2,
            standardSource: 'qa_published_standard', timeBasis: batch ? 'per_batch' : 'per_unit', standardMillisecondsPerUnit: batch ? 5 * hour : hour,
            setupMilliseconds: 0, unitsPerProduct: 1, unitLabel: '套', reportQuantityBasis: 'product', reportUnitLabel: '套', inputQty: 0, status: 'pending' },
        ] },
      } },
    }, include: { processRoute: { include: { steps: { orderBy: { position: 'asc' } } } }, qrTicket: true } });
    assert.ok(result.processRoute && result.qrTicket);
    return { id: result.id, code: result.code, routeId: result.processRoute.id, upstreamStepId: result.processRoute.steps[0].id,
      stepId: result.processRoute.steps[1].id, publicCode: result.qrTicket.publicCode };
  }
  const piece = await order('计件');
  const batch = await order('按批', true);
  const browser = await order('手机操作');
  const completions: { id: string; employeeId: string; date: string; expectedHours: number }[] = [];
  async function report(qaOrder: typeof piece, index: number, date: string, qty: number, expectedHours: number) {
    const route = await prisma.workOrderProcessRoute.findUniqueOrThrow({ where: { id: qaOrder.routeId } });
    const result = await completeProcessStep({ routeId: qaOrder.routeId, stepId: qaOrder.stepId, processedQty: qty, defectQty: 0,
      workDate: date, employeeIds: [employees[index].id], requireParticipants: true, autoAssignLabor: true, reportSource: 'QR_MOBILE',
      principalEmployeeId: employees[index].id, idempotencyKey: `${marker}-${completions.length}`, expectedRouteVersion: route.version,
      userId: actor.id, actor: actor.displayName!,
    });
    assert.equal(result.autoAssignedLaborMilliseconds, expectedHours * hour, `Expected immediate ${expectedHours}h on ${date}`);
    assert.equal(result.coverageStatus, 'pending');
    completions.push({ id: result.completionId, employeeId: employees[index].id, date, expectedHours });
  }
  await report(piece, 0, yesterday, 8, 8);
  await report(piece, 0, today, 6, 6);
  await report(piece, 1, today, 2, 2);
  await report(piece, 2, today, 2, 2);
  await report(batch, 1, yesterday, 4, 2);
  await report(batch, 1, today, 6, 3);
  const abnormal = await createFieldAbnormalTimeEvent({ code: piece.publicCode, userId: actor.id, employeeId: employees[0].id,
    body: { stepId: piece.stepId, category: ABNORMAL_TIME_CATEGORIES[0].value, workDate: yesterday,
      durationMinutes: 60, employeeIds: [employees[0].id], reason: '隔离验收：已确认一小时损耗', idempotencyKey: `qra-${randomUUID()}` },
  });
  await reviewAbnormalTimeEvent({ eventId: abnormal.event.id, reviewerId: actor.id, decision: 'confirmed', note: '隔离验收认可时长', canReviewEmployeeIds: async () => true });
  const fixture = { marker, today, yesterday, runtime: { base: expectedBase, database: target.pathname.slice(1), databasePort: target.port },
    actor: { id: actor.id, username: actor.username }, operator: { id: operator.id, username: operator.username },
    employees: employees.map(employee => ({ id: employee.id, name: employee.name, employeeNo: employee.employeeNo })), orders: { piece, batch, browser }, completions, abnormalId: abnormal.event.id };
  await mkdir(dirname(fixtureFile), { recursive: true });
  await writeFile(fixtureFile, JSON.stringify(fixture, null, 2));
  console.log(JSON.stringify({ ok: true, syntheticEmployees: employees.length, realServiceCompletions: completions.length, pendingCoverageRecordedImmediately: true, productionDataTouched: false }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
