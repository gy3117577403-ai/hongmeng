import assert from 'node:assert/strict';
import test from 'node:test';
import { reportedWorkloadMilliseconds, workloadStep, workloadTotals, workloadPeople, remainingNormalMilliseconds,
  workloadCoverage, workloadCapacityBalance, WORKLOAD_HOUR as H, type WorkloadTask, type WorkloadEmployeeInput } from '../lib/production-workload';

const step = (values: Partial<Parameters<typeof workloadStep>[0]> = {}) => workloadStep({ id: 's', name: '压接', position: 1, original: 100 * H, reported: 40 * H, ...values });
const task = (steps: ReturnType<typeof step>[]): WorkloadTask => ({ id: 't', workOrderId: 'o', code: 'TEST', specification: 'TEST', customer: '', kind: 'plan', sourceWeek: '2026-09-14', routeVersion: 1, steps });
const employee = (values: Partial<WorkloadEmployeeInput> = {}): WorkloadEmployeeInput => ({ id: 'e', name: '测试', employeeNo: '01', department: '生产部', team: '量产', position: '操作员', attainmentStream: 'batch', isActive: true, hireDate: new Date('2026-01-01'), resignedAt: null, attainmentPolicyChanges: [], ...values });

test('pending work counts before predecessor completion and matching does not increase earned work', () => {
  const pending = workloadTotals([task([step({ pending: 40 * H })])]);
  const matched = workloadTotals([task([step()])]);
  assert.equal(pending.completed, 40 * H); assert.equal(pending.remaining, 60 * H); assert.equal(pending.percentage, 40);
  assert.equal(matched.completed, pending.completed); assert.equal(matched.pending, 0);
});
test('carryover removes prior work per step and excess work never cancels another unfinished step', () => {
  const total = workloadTotals([task([step({ before: 20 * H, reported: 100 * H }), step({ id: 's2', original: 100 * H, reported: 0 })])]);
  assert.equal(total.planned, 180 * H); assert.equal(total.completed, 80 * H); assert.equal(total.remaining, 100 * H); assert.equal(total.excess, 20 * H);
});
test('WIP transfer adjusts ownership explicitly and does not duplicate remaining labor', () => {
  const native = task([step({ before: 20 * H, movedOut: 50 * H, reported: 30 * H })]);
  const wip = { ...task([step({ original: 50 * H, reported: 10 * H })]), kind: 'wip' as const };
  const total = workloadTotals([native, wip]); assert.equal(total.planned, 80 * H); assert.equal(total.completed, 40 * H); assert.equal(total.remaining, 40 * H);
});
test('missing standards suppress percentages and empty work avoids division by zero', () => {
  assert.equal(workloadTotals([task([step({ missingStandard: true })])]).percentage, null);
  assert.equal(workloadTotals([]).percentage, null); assert.equal(workloadCoverage(100, 0), null);
  assert.equal(workloadCoverage(0, 100), 0); assert.equal(workloadCoverage(100, 100, true), null);
});
test('per-batch setup and multiple reports conserve the original standard labor', () => {
  const snapshot = { timeBasis: 'per_batch', standardMillisecondsPerUnit: 9 * H, setupMilliseconds: H };
  assert.equal(reportedWorkloadMilliseconds(snapshot, 3, 10) + reportedWorkloadMilliseconds(snapshot, 7, 10), 10 * H);
  assert.equal(reportedWorkloadMilliseconds({ timeBasis: 'per_unit', standardMillisecondsPerUnit: H, unitsPerProduct: 2 }, 3, 10), 6 * H);
});
test('expected capacity excludes sample and managers without using attendance or 95 percent', () => {
  const people = workloadPeople([employee(), employee({ id: 'sample', attainmentStream: 'sample' }), employee({ id: 'leader', position: '生产组长' }), employee({ id: 'manager', position: '生产主管' })], '2026-09-14', new Date('2026-09-16T08:00:00+08:00'));
  assert.equal(people.filter(p => p.included).length, 1); assert.equal(people[0].planned, 48 * H); assert.equal(people[0].remaining, 32 * H);
});
test('remaining normal capacity observes lunch, weekday and historical week boundaries', () => {
  assert.equal(remainingNormalMilliseconds('2026-09-16', new Date('2026-09-16T12:30:00+08:00')), 4 * H);
  assert.equal(remainingNormalMilliseconds('2026-09-16', new Date('2026-09-16T16:30:00+08:00')), H / 2);
  assert.equal(workloadPeople([employee()], '2026-09-14', new Date('2026-09-20T09:00:00+08:00'))[0].remaining, 0);
});
test('employment and effective policy dates adjust only planned working days', () => {
  const people = workloadPeople([employee({ hireDate: new Date('2026-09-16'), resignedAt: new Date('2026-09-18') })], '2026-09-14', new Date('2026-09-14T08:00:00+08:00'));
  assert.equal(people[0].days, 2); assert.equal(people[0].planned, 16 * H);
  const changed = workloadPeople([employee({ attainmentPolicyChanges: [{ effectiveDate: '2026-09-17', revision: 1,
    beforePolicy: { department: '生产部', position: '操作员', attainmentStream: 'batch' }, afterPolicy: { department: '生产部', position: '主管', attainmentStream: 'batch' } }] })], '2026-09-14', new Date('2026-09-14T08:00:00+08:00'));
  assert.equal(changed[0].planned, 24 * H);
});
test('team scoped personnel totals do not include another team', () => {
  const people = workloadPeople([employee(), employee({ id: 'b', team: '外组' })], '2026-09-14', new Date('2026-09-16T08:00:00+08:00'), new Set(['量产']));
  assert.equal(people.length, 1);
});

test('incomplete demand cannot turn apparent spare hours into a shortage or a sufficiency claim', () => {
  assert.deepEqual(workloadCapacityBalance({ gap: 0, surplus: 20 * H }, true), { label: '需求待补齐', value: null });
  assert.deepEqual(workloadCapacityBalance({ gap: 5 * H, surplus: 0 }, true), { label: '已知至少缺口', value: 5 * H });
  assert.deepEqual(workloadCapacityBalance({ gap: 0, surplus: 20 * H }, false), { label: '余量', value: 20 * H });
});
