import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateActualLaborMilliseconds,
  calculateAttainmentBasisPoints,
  calculateProcessReportProgress,
  calculateProductProcessLaborMilliseconds,
  calculateStandardLaborMilliseconds,
  employeeReportRange,
  serializeEmployee,
} from '../lib/process-time';
import { productTimeTotalMilliseconds, validateProductTimeEntries } from '../lib/product-time';
import { sameProductQuotationTime, validateProductQuotationTime } from '../lib/product-quotation';

test('per-unit standard labor includes setup time and per-product process count', () => {
  const result = calculateStandardLaborMilliseconds({
    timeBasis: 'per_unit',
    standardMillisecondsPerUnit: 2_500,
    setupMilliseconds: 60_000,
    goodQty: 100,
    unitsPerProduct: 4,
  });
  assert.equal(result, 1_060_000);
});

test('per-batch standard labor does not multiply by production quantity', () => {
  const result = calculateStandardLaborMilliseconds({
    timeBasis: 'per_batch',
    standardMillisecondsPerUnit: 600_000,
    setupMilliseconds: 120_000,
    goodQty: 1_000,
    unitsPerProduct: 8,
  });
  assert.equal(result, 720_000);
});

test('actual labor subtracts break duration', () => {
  const result = calculateActualLaborMilliseconds(
    new Date('2026-07-17T08:00:00+08:00'),
    new Date('2026-07-17T10:00:00+08:00'),
    15 * 60_000,
  );
  assert.equal(result, 105 * 60_000);
});

test('attainment basis points use standard divided by actual', () => {
  assert.equal(calculateAttainmentBasisPoints(90 * 60_000, 75 * 60_000), 12_000);
  assert.equal(calculateAttainmentBasisPoints(60 * 60_000, 75 * 60_000), 8_000);
});

test('China weekly report range starts on Monday and ends the next Monday', () => {
  const range = employeeReportRange('week', '2026-07-17');
  assert.equal(range.start.toISOString(), '2026-07-12T16:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-07-19T16:00:00.000Z');
});

test('China Sunday belongs to the preceding Monday week', () => {
  const range = employeeReportRange('week', '2026-07-19');
  assert.equal(range.start.toISOString(), '2026-07-12T16:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-07-19T16:00:00.000Z');
});

test('employee serialization keeps position and team as separate profile fields', () => {
  const now = new Date('2026-07-17T00:00:00.000Z');
  const employee = serializeEmployee({
    id: 'employee-1',
    employeeNo: '0001',
    name: '林波',
    department: '生产',
    position: '压接操作员',
    team: '前端一组',
    isActive: true,
    attendanceEnabled: true,
    createdAt: now,
    updatedAt: now,
  });

  assert.equal(employee.position, '压接操作员');
  assert.equal(employee.team, '前端一组');
});

test('product time stores one aggregate per-set duration for each process', () => {
  const result = validateProductTimeEntries([
    { processDefinitionId: 'cutting', unitSeconds: 6 },
    { processDefinitionId: 'crimping', unitSeconds: 32, parallelWithPrevious: true },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[1].unitMilliseconds, 32_000);
  assert.equal(result.entries[1].actionMilliseconds, null);
  assert.equal(result.entries[1].occurrences, 1);
  assert.equal(result.entries[1].setupMilliseconds, 0);
  assert.equal(result.entries[0].sequenceGroup, 1);
  assert.equal(result.entries[1].sequenceGroup, 1);
  assert.equal(productTimeTotalMilliseconds(result.entries), 38_000);
});

test('product time requires the aggregate duration and does not derive it from action counts', () => {
  const result = validateProductTimeEntries([
    { processDefinitionId: 'terminal-insertion', actionSeconds: 6.75, occurrences: 8 },
  ]);
  assert.equal(result.ok, false);
});

test('sequential product processes advance to a new sequence group', () => {
  const result = validateProductTimeEntries([
    { processDefinitionId: 'cutting', unitSeconds: 20 },
    { processDefinitionId: 'stripping', unitSeconds: 10 },
    { processDefinitionId: 'crimping', unitSeconds: 35, parallelWithPrevious: true },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.entries.map(entry => entry.sequenceGroup), [1, 2, 2]);
});

test('aggregate process labor multiplies only by employee good quantity', () => {
  assert.equal(calculateProductProcessLaborMilliseconds({
    aggregateMillisecondsPerProduct: 35_000,
    goodQty: 120,
  }), 4_200_000);
});

test('multiple employee reports accumulate until the process target is reached', () => {
  const first = calculateProcessReportProgress({
    targetQuantity: 8_500,
    previouslyReportedGoodQuantity: 0,
    submittedGoodQuantity: 3_000,
  });
  assert.deepEqual(first, {
    reportedGoodQuantity: 3_000,
    remainingGoodQuantity: 5_500,
    completed: false,
  });
  const second = calculateProcessReportProgress({
    targetQuantity: 8_500,
    previouslyReportedGoodQuantity: first.reportedGoodQuantity,
    submittedGoodQuantity: 5_500,
  });
  assert.equal(second.completed, true);
  assert.equal(second.remainingGoodQuantity, 0);
  assert.throws(() => calculateProcessReportProgress({
    targetQuantity: 8_500,
    previouslyReportedGoodQuantity: 8_000,
    submittedGoodQuantity: 501,
  }), /剩余数量 500/);
});

test('product quotation time stores a positive per-set commercial duration', () => {
  const result = validateProductQuotationTime({
    unitSeconds: '157.5',
    sourceType: 'manual',
    remark: '报价核定',
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.unitMilliseconds, 157_500);
  assert.equal(result.value.sourceType, 'manual');
  assert.equal(result.value.remark, '报价核定');
});

test('product quotation time rejects zero and durations above one day', () => {
  const zero = validateProductQuotationTime({ unitSeconds: 0 });
  const excessive = validateProductQuotationTime({ unitSeconds: 86_401 });
  assert.equal(zero.ok, false);
  assert.equal(excessive.ok, false);
});

test('identical quotation updates are idempotent', () => {
  const input = {
    unitMilliseconds: 120_000,
    sourceType: 'quotation' as const,
    sourceRefId: 'quote-2026-01',
    remark: null,
  };
  assert.equal(sameProductQuotationTime(input, input), true);
  assert.equal(sameProductQuotationTime({ ...input, unitMilliseconds: 121_000 }, input), false);
});

test('product quotation time accepts an explicitly adopted planning order duration', () => {
  const result = validateProductQuotationTime({
    unitSeconds: 35,
    sourceType: 'planning_order',
    sourceRefId: 'plan-order-1',
    remark: '采用计划单套工时',
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.unitMilliseconds, 35_000);
  assert.equal(result.value.sourceType, 'planning_order');
  assert.equal(result.value.sourceRefId, 'plan-order-1');
});

test('product time rejects zero, duplicate processes, and ambiguous empty rows', () => {
  assert.equal(validateProductTimeEntries([{ processDefinitionId: 'cutting', unitSeconds: 0 }]).ok, false);
  assert.equal(validateProductTimeEntries([{ processDefinitionId: 'cutting' }]).ok, false);
  assert.equal(validateProductTimeEntries([
    { processDefinitionId: 'cutting', unitSeconds: 6 },
    { processDefinitionId: 'cutting', unitSeconds: 7 },
  ]).ok, false);
});
