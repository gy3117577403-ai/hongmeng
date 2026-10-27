import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { resolveAccessContext, type AccessGrant } from '../lib/department-access';
import type { CurrentUserDTO } from '../types';
import { approveOtherWorkBatch, parseOtherWorkBatch, selectOtherWorkBatch } from '../lib/other-work-time-batch';
import { commandOtherWork, listOtherWork, listOtherWorkCompact, otherWorkContext, otherWorkSummary, otherWorkToday } from '../lib/other-work-time-service';
import { loadEmployeeHoursReport } from '../lib/employee-hours-report-service';
import { employeeReportRange } from '../lib/process-time';

test('batch request rejects duplicate IDs and unbounded work', () => {
  const batchId = randomUUID();
  assert.throws(() => parseOtherWorkBatch({ batchId, items: [{ id: 'x', version: 0 }, { id: 'x', version: 1 }] }));
  assert.throws(() => parseOtherWorkBatch({ batchId, items: Array.from({ length: 31 }, (_, i) => ({ id: String(i), version: 0 })) }));
  assert.throws(() => parseOtherWorkBatch({ batchId, items: [{ id: 'x', version: -1 }] }));
  assert.throws(() => parseOtherWorkBatch({ batchId: 'bad', items: [{ id: 'x', version: 0 }] }));
});

test('batch approval preserves per-record authorization, atomic audit and realtime hours', { skip: process.env.RUN_DB_INTEGRATION !== '1' }, async t => {
  const db = new URL(process.env.DATABASE_URL || '');
  assert.ok(['localhost', '127.0.0.1'].includes(db.hostname) && db.pathname === '/hongmeng_ci' && process.env.CI === 'true', 'Only isolated CI database');
  const marker = 'OHB-' + randomUUID().slice(0, 8), today = otherWorkToday(), date = new Date(today + 'T00:00:00Z');
  const team = await prisma.productionTeam.create({ data: { name: marker, code: marker } });
  const employees = await Promise.all([0, 1, 2].map(n => prisma.employee.create({ data: { employeeNo: `${marker}-${n}`, name: `${marker}-${n}`, team: team.name, department: '生产部', hireDate: date } })));
  const grants: AccessGrant[] = [{ profile: 'FIELD_REPORTER', grantType: 'PRIMARY', scopeKey: 'SELF' }, { profile: 'WORKSHOP_TEAM_LEADER', grantType: 'PRIMARY', scopeKey: 'TEAM:' + team.id }, { profile: 'ADMIN_GLOBAL', grantType: 'PRIMARY', scopeKey: 'GLOBAL' }];
  const users = await Promise.all(employees.map((employee, i) => prisma.user.create({ data: { username: `${marker}-${i}`, displayName: employee.name, employeeId: employee.id, passwordHash: 'isolated', laborRole: i === 2 ? 'ADMIN' : 'EMPLOYEE' } })));
  const actors = users.map((user, i) => ({ ...user, access: resolveAccessContext([grants[i]]), dailyPlanningTeamIds: [] } as unknown as CurrentUserDTO));
  const [operator, leader, admin] = actors;
  const create = (i: number, overrides = {}) => prisma.otherWorkTimeRequest.create({ data: {
    employeeId: employees[0].id, createdById: users[0].id, categoryId: 'other-sample', categoryNameSnapshot: '协助样品',
    employeeNameSnapshot: employees[0].name, employeeNoSnapshot: employees[0].employeeNo, teamIdSnapshot: team.id, teamSnapshot: team.name,
    workDate: date, description: `${marker} ${i}`, requestedMinutes: 5, status: 'PENDING', submittedAt: new Date(),
    attainmentEligibleSnapshot: true, attainmentStreamSnapshot: 'batch', idempotencyKey: randomUUID(), requestHash: randomUUID(), ...overrides } });
  const listQuery = new URLSearchParams({ scope: 'manage', search: marker, status: 'PENDING', from: today, to: today });
  const report = async () => (await loadEmployeeHoursReport({ ...employeeReportRange('custom', today, today, today), period: 'custom', employeeIdConstraint: employees[0].id })).report;
  let toolingJobId: string | undefined;
  try {
    await prisma.attendanceRecord.create({ data: { employeeId: employees[0].id, workDate: date, status: 'confirmed', attendanceType: 'normal', plannedMilliseconds: 28800000, actualMilliseconds: 28800000, segments: [], departmentSnapshot: '生产部', teamSnapshot: team.name, attainmentEligibleSnapshot: true, attainmentStreamSnapshot: 'batch' } });
    const rows: Awaited<ReturnType<typeof create>>[] = [];
    for (let i = 0; i < 35; i++) rows.push(await create(i));
    const own = await create(40, { employeeId: leader.employeeId, createdById: leader.id });
    const outside = await create(41, { teamIdSnapshot: null, teamSnapshot: 'outside' });
    await t.test('selection spans pages but excludes self and preserves every filter', async () => {
      const selection = await selectOtherWorkBatch(leader, listQuery);
      assert.equal(selection.rows.length, 35); assert.equal(selection.skipped, 1);
      assert.ok(selection.rows.every(row => row.id !== own.id && row.id !== outside.id));
      assert.equal((await selectOtherWorkBatch(leader, new URLSearchParams({ ...Object.fromEntries(listQuery), search: marker + ' missing' }))).rows.length, 0);
      await assert.rejects(selectOtherWorkBatch(operator, listQuery));
    });
    await t.test('compact pages and separate summaries match the legacy ledger', async () => {
      const [legacy, compact, summary] = await Promise.all([listOtherWork(leader, listQuery), listOtherWorkCompact(leader, listQuery), otherWorkSummary(leader, listQuery)]);
      assert.equal(compact.rows.length, 30); assert.equal(compact.pagination.total, legacy.pagination.total);
      assert.deepEqual(summary.summary, legacy.summary); assert.deepEqual(summary.statusCounts, legacy.statusCounts);
      assert.ok(compact.rows.every(row => row.attachments.length === 0 && row.attachmentCount === 0));
      assert.equal((await otherWorkContext(leader, rows[0].id)).expanded, false);
      assert.equal((await otherWorkContext(leader, rows[0].id, true)).reviewerAvailable, true);
      const rejected = await create(42);
      await commandOtherWork(leader, rejected.id, { action: 'REJECT', version: 0, reason: '请补充工作说明' });
      const rejectedQuery = new URLSearchParams({ ...Object.fromEntries(listQuery), status: 'REJECTED' });
      const [legacyRejected, compactRejected] = await Promise.all([listOtherWork(leader, rejectedQuery), listOtherWorkCompact(leader, rejectedQuery)]);
      // The existing ledger card locates the latest rejection by action.
      assert.equal(compactRejected.rows[0].reviews.find(review => review.action === 'REJECT')?.reason,
        [...legacyRejected.rows[0].reviews].reverse().find(review => review.action === 'REJECT')?.reason);
      assert.equal(compactRejected.rows[0].reviews[0].reason, '请补充工作说明');
    });
    await t.test('concurrent retries approve once and do not increase submitted hours', async () => {
      const before = await report();
      const body = { batchId: randomUUID(), items: rows.slice(0, 30).map(({ id, version }) => ({ id, version })) };
      const [first, second] = await Promise.all([approveOtherWorkBatch(leader, body), approveOtherWorkBatch(leader, body)]);
      assert.ok([...first.results, ...second.results].every(row => row.outcome === 'approved'));
      assert.equal(await prisma.otherWorkTimeReview.count({ where: { requestId: { in: body.items.map(row => row.id) }, action: 'APPROVE' } }), 30);
      assert.equal(await prisma.systemNotification.count({ where: { sourceId: { in: body.items.map(row => row.id) }, eventType: 'other_work_approve' } }), 30);
      const after = await report();
      assert.equal(after.summary.otherWorkMilliseconds, before.summary.otherWorkMilliseconds);
      assert.equal(after.summary.attainmentBasisPoints, before.summary.attainmentBasisPoints);
      assert.equal((await approveOtherWorkBatch(leader, body)).results.filter(row => row.replayed).length, 30);
    });
    await t.test('self, foreign, stale, withdrawn and processed rows do not block valid siblings', async () => {
      await commandOtherWork(operator, rows[31].id, { action: 'WITHDRAW', version: 0 });
      await prisma.otherWorkTimeRequest.update({ where: { id: rows[32].id }, data: { version: { increment: 1 } } });
      const result = await approveOtherWorkBatch(leader, { batchId: randomUUID(), items: [own, outside, rows[0], rows[30], rows[31], rows[32]].map(({ id }) => ({ id, version: 0 })) });
      assert.equal(result.results.filter(row => row.outcome === 'approved').length, 1);
      assert.equal(result.results.filter(row => row.outcome === 'skipped').length, 5);
      assert.equal((await prisma.otherWorkTimeRequest.findUniqueOrThrow({ where: { id: own.id } })).status, 'PENDING');
    });
    await t.test('audit failure rolls back only that record and leaves it retryable', async () => {
      const bad = await create(45), good = await create(46);
      const name = 'oh_batch_test_' + randomUUID().replaceAll('-', '');
      // Only this generated UUID is affected; the test guard requires the
      // disposable CI database. The trigger is removed even on assertion failure.
      await prisma.$executeRawUnsafe(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."requestId" = '${bad.id}' AND NEW.action = 'APPROVE' THEN RAISE EXCEPTION 'isolated audit failure'; END IF; RETURN NEW; END $$`);
      try {
        await prisma.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON other_work_time_reviews FOR EACH ROW EXECUTE FUNCTION ${name}()`);
        const result = await approveOtherWorkBatch(leader, { batchId: randomUUID(), items: [bad, good].map(({ id, version }) => ({ id, version })) });
        assert.deepEqual(result.results.map(row => row.outcome), ['failed', 'approved']);
        const rolledBack = await prisma.otherWorkTimeRequest.findUniqueOrThrow({ where: { id: bad.id } });
        assert.equal(rolledBack.status, 'PENDING'); assert.equal(rolledBack.version, 0);
        assert.equal(await prisma.otherWorkTimeReview.count({ where: { requestId: bad.id, action: 'APPROVE' } }), 0);
        assert.equal(await prisma.systemNotification.count({ where: { sourceId: bad.id } }), 0);
      } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON other_work_time_reviews`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION ${name}()`);
      }
      assert.equal((await approveOtherWorkBatch(leader, { batchId: randomUUID(), items: [{ id: bad.id, version: 0 }] })).results[0].outcome, 'approved');
    });
    await t.test('tooling precision and correction/void behavior remain unchanged', async () => {
      const job = await prisma.toolingJob.create({ data: { actorId: operator.id, employeeId: employees[0].id, actorName: 'test', employeeNo: employees[0].employeeNo, kind: 'ASSIST', status: 'COMPLETED', terminalSnapshot: {}, contextSnapshot: {}, startedAt: date } });
      toolingJobId = job.id;
      const tooling = await create(50, { toolingJobId: job.id, reportedMilliseconds: 241234 });
      const before = await report();
      const result = await approveOtherWorkBatch(leader, { batchId: randomUUID(), items: [{ id: tooling.id, version: 0 }] });
      assert.equal(result.results[0].outcome, 'approved');
      assert.equal((await report()).summary.otherWorkMilliseconds, before.summary.otherWorkMilliseconds);
      await assert.rejects(commandOtherWork(admin, tooling.id, { action: 'VOID', version: 1, reason: 'must correct source' }), /端子调模/);
      const reduced = await commandOtherWork(leader, rows[33].id, { action: 'APPROVE', version: 0, approvedMinutes: 3, reason: '核减核对' });
      const afterReduction = await report();
      await commandOtherWork(admin, reduced.id, { action: 'VOID', version: reduced.version, reason: '验收作废' });
      assert.equal((await report()).summary.otherWorkMilliseconds, afterReduction.summary.otherWorkMilliseconds - 180000);
    });
  } finally {
    const ids = (await prisma.otherWorkTimeRequest.findMany({ where: { description: { startsWith: marker } }, select: { id: true } })).map(row => row.id);
    await prisma.systemNotification.deleteMany({ where: { sourceType: 'other_work_time', sourceId: { in: ids } } });
    await prisma.otherWorkTimeReview.deleteMany({ where: { requestId: { in: ids } } });
    await prisma.otherWorkTimeRequest.deleteMany({ where: { id: { in: ids } } });
    if (toolingJobId) await prisma.toolingJob.delete({ where: { id: toolingJobId } });
    await prisma.attendanceRecord.deleteMany({ where: { employeeId: { in: employees.map(e => e.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(u => u.id) } } });
    await prisma.employee.deleteMany({ where: { id: { in: employees.map(e => e.id) } } });
    await prisma.productionTeam.delete({ where: { id: team.id } });
  }
});
