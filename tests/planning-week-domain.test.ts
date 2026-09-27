import test from 'node:test';
import assert from 'node:assert/strict';
import { weekRemainder, subtractWorkload, isScheduledPlanningBatch } from '../lib/planning-week-domain';
const step = { status: 'current', goodOutputQty: 0, processedQty: 0, timeBasis: 'per_unit', standardMillisecondsPerUnit: 60000, setupMilliseconds: 0, unitsPerProduct: 1, countsForEfficiency: true };

test('a visible retained or deferred row does not occupy the active week count', () => {
  const rows = [{}, { scheduleState: 'ACTIVE' }, { scheduleState: 'DEFERRED' }, { scheduleState: 'ACTIVE', retainedWeek: true }];
  assert.equal(rows.length, 4);
  assert.equal(rows.filter(isScheduledPlanningBatch).length, 2);
});
test('week remainder follows unfinished operations, not actual hours or whole-product quantity alone', () => {
  const r = weekRemainder(10, 120000, 4, [{ ...step, id:'first', status:'completed', goodOutputQty:10, processedQty:10 }, { ...step, id:'last', goodOutputQty:4, processedQty:4 }]);
  assert.equal(r.remainingQuantity,6); assert.equal(r.remainingStandard,360000n); assert.equal(r.remainingPlanned,360000n);
  assert.equal(subtractWorkload(r.planned,r.remainingPlanned),840000n);
  assert.deepEqual(r.stepWork,{first:{full:'600000',remaining:'0'},last:{full:'600000',remaining:'360000'}});
});
test('setup time is retained in original week and unknown standards remain explicitly unknown', () => {
  const r=weekRemainder(10,61000,4,[{...step, setupMilliseconds:10000, processedQty:4,goodOutputQty:4}]);
  assert.equal(r.standard,610000n);assert.equal(r.remainingStandard,360000n);
  assert.equal(weekRemainder(10,null,0,[]).remainingPlanned,null);
  assert.equal(weekRemainder(10,60000,0,[]).remainingPlanned,600000n);
  assert.equal(subtractWorkload(null,100n),null);
});

test('skipped operations never inflate work moved into a future week', () => {
  const r = weekRemainder(10,60000,4,[{...step,status:'skipped'}, {...step,processedQty:4,goodOutputQty:4}]);
  assert.equal(r.standard,600000n);assert.equal(r.remainingStandard,360000n);assert.equal(r.remainingPlanned,360000n);
});
