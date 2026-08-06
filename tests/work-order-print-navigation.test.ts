import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeWorkOrderPrintReturnTo, workOrderPrintReturnLabel } from '../lib/work-order-print-navigation';

test('print return target preserves supported source pages and query state', () => {
  assert.equal(sanitizeWorkOrderPrintReturnTo('/production?scope=next&view=all'), '/production?scope=next&view=all');
  assert.equal(sanitizeWorkOrderPrintReturnTo('/weekly-plan-center?weekStart=2026-08-03'), '/weekly-plan-center?weekStart=2026-08-03');
  assert.equal(workOrderPrintReturnLabel('/weekly-plan-center?weekStart=2026-08-03'), '返回计划中心');
});

test('print return target rejects external, nested and recursive print locations', () => {
  assert.equal(sanitizeWorkOrderPrintReturnTo('https://example.com'), '/production');
  assert.equal(sanitizeWorkOrderPrintReturnTo('//example.com/production'), '/production');
  assert.equal(sanitizeWorkOrderPrintReturnTo('/production/qr-print?printIds=1'), '/production');
  assert.equal(sanitizeWorkOrderPrintReturnTo('/workspace/issues'), '/production');
  assert.equal(sanitizeWorkOrderPrintReturnTo('/production\\evil'), '/production');
});
