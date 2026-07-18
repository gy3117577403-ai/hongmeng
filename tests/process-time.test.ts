import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateActualLaborMilliseconds,
  calculateAttainmentBasisPoints,
  calculateStandardLaborMilliseconds,
  employeeReportRange,
  serializeEmployee,
} from '../lib/process-time';
import { productTimeTotalMilliseconds, validateProductTimeEntries } from '../lib/product-time';

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

test('product time accepts direct per-product seconds and keeps blank processes absent', () => {
  const result = validateProductTimeEntries([
    { processDefinitionId: 'cutting', unitSeconds: 6, occurrences: 1 },
    { processDefinitionId: 'crimping', unitSeconds: 32, actionSeconds: 4, occurrences: 8 },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[1].unitMilliseconds, 32_000);
  assert.equal(result.entries[1].actionMilliseconds, 4_000);
  assert.equal(result.entries[1].occurrences, 8);
  assert.equal(productTimeTotalMilliseconds(result.entries), 38_000);
});

test('product time can derive per-product seconds from action time and occurrences', () => {
  const result = validateProductTimeEntries([
    { processDefinitionId: 'terminal-insertion', actionSeconds: 6.75, occurrences: 8 },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.entries[0].unitMilliseconds, 54_000);
});

test('product time rejects zero, duplicate processes, and ambiguous empty rows', () => {
  assert.equal(validateProductTimeEntries([{ processDefinitionId: 'cutting', unitSeconds: 0 }]).ok, false);
  assert.equal(validateProductTimeEntries([{ processDefinitionId: 'cutting' }]).ok, false);
  assert.equal(validateProductTimeEntries([
    { processDefinitionId: 'cutting', unitSeconds: 6 },
    { processDefinitionId: 'cutting', unitSeconds: 7 },
  ]).ok, false);
});
