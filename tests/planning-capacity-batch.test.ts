import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import {
  loadPlanningCapacities,
  loadPlanningCapacity,
} from '../lib/planning-capacity';
import { parsePlanningDateRange, planningMonthRange } from '../lib/planning-date-range';

const hour = 60 * 60 * 1000;
const hours = (value: number) => BigInt(value * hour);
const shanghaiDate = (value: string) => new Date(`${value}T00:00:00.000+08:00`);
const databaseDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

test('batched capacity rejects a segment outside its loaded snapshot range before querying', async () => {
  const month = planningMonthRange('2026-09');
  const outside = parsePlanningDateRange('2026-09-30', '2026-10-01');
  await assert.rejects(
    loadPlanningCapacities(month, [outside]),
    /容量分段日期必须位于查询范围内/,
  );
});

test('batched month capacity matches independent range loads with fixed query count and strict date boundaries', async t => {
  const batches = [
    { quantity: 1, plannedCompletionDate: shanghaiDate('2026-09-01'), totalMillisecondsSnapshot: hours(10), unitMillisecondsSnapshot: null, planOrder: { planningUnitMilliseconds: null }, holds: [] },
    { quantity: 1, plannedCompletionDate: shanghaiDate('2026-09-06'), totalMillisecondsSnapshot: hours(6), unitMillisecondsSnapshot: null, planOrder: { planningUnitMilliseconds: null }, holds: [{ id: 'hold-1' }] },
    { quantity: 1, plannedCompletionDate: shanghaiDate('2026-09-07'), totalMillisecondsSnapshot: hours(20), unitMillisecondsSnapshot: null, planOrder: { planningUnitMilliseconds: null }, holds: [] },
    { quantity: 1, plannedCompletionDate: shanghaiDate('2026-09-10'), totalMillisecondsSnapshot: null, unitMillisecondsSnapshot: null, planOrder: { planningUnitMilliseconds: null }, holds: [] },
    { quantity: 1, plannedCompletionDate: shanghaiDate('2026-10-01'), totalMillisecondsSnapshot: hours(99), unitMillisecondsSnapshot: null, planOrder: { planningUnitMilliseconds: null }, holds: [] },
  ];
  const employees = [
    { id: 'employee-a', hireDate: null, resignedAt: databaseDate('2026-09-07') },
    { id: 'employee-b', hireDate: databaseDate('2026-09-07'), resignedAt: null },
  ];
  const attendance = [
    { workDate: databaseDate('2026-09-01'), actualMilliseconds: 8 * hour },
    { workDate: databaseDate('2026-09-07'), actualMilliseconds: 7 * hour },
    { workDate: databaseDate('2026-10-01'), actualMilliseconds: 99 * hour },
  ];
  const overrides = [
    { workDate: databaseDate('2026-09-06'), dayType: 'temporary_workday', label: '调班', remark: null },
    { workDate: databaseDate('2026-09-09'), dayType: 'holiday', label: '停工', remark: null },
    { workDate: databaseDate('2026-10-01'), dayType: 'holiday', label: '边界外', remark: null },
  ];
  const sourceWipLots = [
    { productionPlanBatch: { plannedCompletionDate: shanghaiDate('2026-09-06') }, steps: [{ remainingStandardMilliseconds: hours(2) }] },
    { productionPlanBatch: { plannedCompletionDate: shanghaiDate('2026-09-07') }, steps: [{ remainingStandardMilliseconds: hours(4) }] },
    { productionPlanBatch: { plannedCompletionDate: shanghaiDate('2026-10-01') }, steps: [{ remainingStandardMilliseconds: hours(50) }] },
  ];
  const targetWipAllocations = [
    { targetWeekStartDate: databaseDate('2026-09-01'), status: 'ACTIVE', plannedStandardMilliseconds: hours(3), completedStandardMilliseconds: 0n },
    { targetWeekStartDate: databaseDate('2026-09-07'), status: 'ACTIVE', plannedStandardMilliseconds: hours(5), completedStandardMilliseconds: 0n },
    { targetWeekStartDate: databaseDate('2026-09-08'), status: 'SUPERSEDED', plannedStandardMilliseconds: hours(40), completedStandardMilliseconds: hours(1) },
    { targetWeekStartDate: databaseDate('2026-10-01'), status: 'ACTIVE', plannedStandardMilliseconds: hours(50), completedStandardMilliseconds: 0n },
  ];

  const calls: Array<{ model: string; start?: number; end?: number }> = [];
  const inRequestedRange = <T>(
    model: string,
    rows: T[],
    range: { gte: Date; lt: Date },
    dateOf: (row: T) => Date,
  ): T[] => {
    calls.push({ model, start: range.gte.getTime(), end: range.lt.getTime() });
    return rows.filter(row => dateOf(row) >= range.gte && dateOf(row) < range.lt);
  };

  const replaceFindMany = (delegate: unknown, implementation: (args: any) => Promise<unknown>) => {
    const mutable = delegate as { findMany: (args: any) => Promise<unknown> };
    const original = mutable.findMany;
    mutable.findMany = implementation;
    t.after(() => { mutable.findMany = original; });
  };
  replaceFindMany(prisma.productionPlanBatch, async (args: any) => (
    inRequestedRange('productionPlanBatch', batches, args.where.plannedCompletionDate, row => row.plannedCompletionDate)
  ));
  replaceFindMany(prisma.employee, async () => {
    calls.push({ model: 'employee' });
    return employees;
  });
  replaceFindMany(prisma.attendanceRecord, async (args: any) => (
    inRequestedRange('attendanceRecord', attendance, args.where.workDate, row => row.workDate)
  ));
  replaceFindMany(prisma.attendanceCalendarDay, async (args: any) => (
    inRequestedRange('attendanceCalendarDay', overrides, args.where.workDate, row => row.workDate)
  ));
  replaceFindMany(prisma.semiFinishedLot, async (args: any) => (
    inRequestedRange('semiFinishedLot', sourceWipLots, args.where.productionPlanBatch.plannedCompletionDate, row => row.productionPlanBatch.plannedCompletionDate)
  ));
  replaceFindMany(prisma.wipWeekAllocation, async (args: any) => (
    inRequestedRange('wipWeekAllocation', targetWipAllocations, args.where.targetWeekStartDate, row => row.targetWeekStartDate)
  ));

  const month = planningMonthRange('2026-09');
  // The first production week crosses the month boundary and is clipped exactly
  // as app/api/planning/month does before asking for weekly metrics.
  const firstWeek = parsePlanningDateRange('2026-09-01', '2026-09-06');
  const secondWeek = parsePlanningDateRange('2026-09-07', '2026-09-13');
  const now = new Date('2026-09-07T12:00:00.000+08:00');

  const batched = await loadPlanningCapacities(month, [month, firstWeek, secondWeek], { now });
  assert.equal(calls.length, 6);
  assert.deepEqual(calls.map(call => call.model).sort(), [
    'attendanceCalendarDay',
    'attendanceRecord',
    'employee',
    'productionPlanBatch',
    'semiFinishedLot',
    'wipWeekAllocation',
  ]);
  for (const call of calls.filter(call => call.start !== undefined)) {
    assert.equal(call.start, month.start.getTime());
    assert.equal(call.end, month.endExclusive.getTime());
  }

  assert.equal(batched[1].scheduledMilliseconds, hours(17).toString());
  assert.equal(batched[1].frozenMilliseconds, hours(6).toString());
  assert.equal(batched[1].plannedCapacityMilliseconds, hours(48).toString());
  assert.equal(batched[1].confirmedAttendanceMilliseconds, hours(8).toString());
  assert.equal(batched[1].confirmedAttendanceRecordCount, 1);
  assert.equal(batched[1].workdayCount, 6);
  assert.equal(batched[2].scheduledMilliseconds, hours(22).toString());
  assert.equal(batched[2].attendanceScopeScheduledMilliseconds, hours(21).toString());
  assert.equal(batched[2].plannedCapacityMilliseconds, hours(40).toString());
  assert.equal(batched[2].confirmedAttendanceMilliseconds, hours(7).toString());
  assert.equal(batched[2].missingTimeBatchCount, 1);
  assert.equal(batched[2].workdayCount, 5);

  calls.length = 0;
  const independentlyLoaded = await Promise.all([
    loadPlanningCapacity(month, { now }),
    loadPlanningCapacity(firstWeek, { now }),
    loadPlanningCapacity(secondWeek, { now }),
  ]);
  assert.deepEqual(batched, independentlyLoaded);
  assert.equal(calls.length, 18);

  const monthRoute = readFileSync(resolve(import.meta.dirname, '../app/api/planning/month/route.ts'), 'utf8');
  assert.equal((monthRoute.match(/loadPlanningCapacities\(/g) || []).length, 1);
  assert.match(monthRoute, /loadPlanningCapacities\(range, \[range, \.\.\.weekRanges\]\)/);
  assert.doesNotMatch(monthRoute, /Promise\.all\(\[\.\.\.weekMap\.values\(\)\]\.map/);
});
