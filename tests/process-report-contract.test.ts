import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCompletionLaborSnapshot } from '../lib/process-completion-domain';
import { completionLaborUnitsPerProduct, processReportContractIssue, processReportContractTransitionIssue } from '../lib/process-report-contract';
import { productTimeStandardSnapshot, validateProductTimeEntries } from '../lib/product-time';

const action = { reportQuantityBasis: 'action', reportUnitLabel: '个', timeBasis: 'per_unit', unitsPerProduct: 3 };
const product = { reportQuantityBasis: 'product', reportUnitLabel: '套', timeBasis: 'per_unit', unitsPerProduct: 1 };

test('quantity contract permits a withdrawn action step to adopt the complete one-set standard', () => {
  const parsed = validateProductTimeEntries([{ processDefinitionId: 'insert', unitSeconds: 15,
    occurrences: 1, timeBasis: 'per_unit', reportQuantityBasis: 'product', unitLabel: '套' }]);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const snapshot = productTimeStandardSnapshot({ id: 'v6', version: 6 }, {
    ...parsed.entries[0], id: 'entry6',
  } as Parameters<typeof productTimeStandardSnapshot>[1]);
  assert.equal(processReportContractTransitionIssue(action, snapshot, false), null);
  assert.equal(processReportContractIssue(snapshot), null);
  assert.equal(snapshot.reportQuantityBasis, 'product');
  assert.equal(snapshot.unitsPerProduct, 1);
  assert.equal(snapshot.standardMillisecondsPerUnit, 15000);
  assert.equal(processReportContractIssue({ ...snapshot, reportQuantityBasis: 'action' })?.code,
    'PROCESS_ACTION_REPORT_STANDARD_INVALID', 'the previous partial merge must never pass validation');
});

test('active action history cannot change its set conversion, unit or reporting basis', () => {
  for (const incoming of [product, { ...action, unitsPerProduct: 4 },
    { ...action, reportUnitLabel: '套' }, { ...product, timeBasis: 'per_batch' }]) {
    assert.equal(processReportContractTransitionIssue(action, incoming, true)?.code,
      'PROCESS_REPORT_CONTRACT_HISTORY_CONFLICT');
  }
  assert.equal(processReportContractTransitionIssue(product, action, true)?.code,
    'PROCESS_REPORT_CONTRACT_HISTORY_CONFLICT');
  assert.equal(processReportContractTransitionIssue(action, action, true), null, 'same quantity contract permits audited time changes');
  assert.equal(processReportContractTransitionIssue(product, { ...product, unitsPerProduct: 3 }, true), null,
    'per-set reporting may revise its labor multiplier without changing reported quantity units');
});

test('120 action units at five seconds earn ten minutes, without multiplying three actions again', () => {
  const original = calculateCompletionLaborSnapshot({ timeBasis: 'per_unit', eligibleQty: 120,
    standardMillisecondsPerUnit: 5000, setupMilliseconds: 0,
    unitsPerProduct: completionLaborUnitsPerProduct('action', 3) });
  const corrected = calculateCompletionLaborSnapshot({ timeBasis: 'per_unit', eligibleQty: 120,
    standardMillisecondsPerUnit: 6000, setupMilliseconds: 0,
    unitsPerProduct: completionLaborUnitsPerProduct('action', 3) });
  assert.equal(original.totalStandardLaborMilliseconds, 600000n);
  assert.equal(corrected.totalStandardLaborMilliseconds, 720000n);
  assert.equal(corrected.unitsPerProduct, 1);
});
