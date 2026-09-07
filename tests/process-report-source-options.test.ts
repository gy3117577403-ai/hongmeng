import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProcessReportSource, processReportSourceDateState, reportSourceCanCoverSteps, type ProcessReportSourceChoice } from '../lib/process-report-source-options';

const native: ProcessReportSourceChoice = { key: 'native', kind: 'NATIVE', availability: 'READY', limits: [{ stepId: 'tape', quantity: 0, actionQuantity: 0 }] };
const lot: ProcessReportSourceChoice = { key: 'lot:one', kind: 'WIP', lotId: 'one', allocationId: 'a', availability: 'READY', limits: [{ stepId: 'tape', quantity: 700, actionQuantity: 700 }] };
test('zero native source is never preselected and a unique legal WIP source is explicit', () => {
  assert.equal(defaultProcessReportSource([native], ['tape']), '');
  assert.equal(defaultProcessReportSource([native, lot], ['tape']), 'lot:one');
  assert.equal(defaultProcessReportSource([native, lot, { ...lot, key: 'lot:two', lotId: 'two' }], ['tape']), '');
  assert.equal(defaultProcessReportSource([native, { ...lot, availability: 'EXPIRED' }], ['tape']), '');
});
test('production date is compared with the actual plan week without inventing a date', () => {
  assert.equal(processReportSourceDateState('2026-08-31', '2026-09-06', '2026-09-07'), 'EXPIRED');
  assert.equal(processReportSourceDateState('2026-09-07', '2026-09-13', '2026-09-07'), 'READY');
  assert.equal(processReportSourceDateState('2026-09-14', '2026-09-20', '2026-09-07'), 'FUTURE');
  assert.equal(processReportSourceDateState(null, null, '2026-09-07'), 'UNSCHEDULED');
});
test('batch source must cover every selected step, not merely one matching step', () => {
  assert.equal(reportSourceCanCoverSteps(lot, ['tape', 'pack']), false);
  assert.equal(reportSourceCanCoverSteps({ ...lot, limits: [...lot.limits, { stepId: 'pack', quantity: 4000, actionQuantity: 4000 }] }, ['tape', 'pack']), true);
  assert.equal(defaultProcessReportSource([{ ...native, limits: [{ stepId: 'tape', quantity: 0, actionQuantity: 30 }] }], ['tape']), 'native');
});
