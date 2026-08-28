import assert from 'node:assert/strict';
import test from 'node:test';
import { canAdjustProductionDates, canManageProductionControl, productionDateKey, serializeProductionControl } from '../lib/production-control';
import { resolveAccessContext } from '../lib/department-access';
import { getProductionAlerts } from '../lib/production-alerts';
import { buildProductionDispatchDocumentRows, renderProductionDispatchPrintHtml } from '../lib/production-dispatch-document';

test('production dates reject rolled-over and ambiguous values and retain China calendar dates', () => {
  for (const invalid of ['2026-02-30', '2026-13-01', '08/28', '星期五', 'invalid']) assert.equal(productionDateKey(invalid), null);
  assert.equal(productionDateKey('2026/8/28'), '2026-08-28');
  assert.equal(productionDateKey('2026-08-27T16:30:00Z'), '2026-08-28');
  assert.equal(productionDateKey(new Date('invalid')), null);
});

test('only planning and admin date grants authorize adjustment; report grants do not authorize control', () => {
  const actor = (profile: Parameters<typeof resolveAccessContext>[0][number]['profile'], departmentCode?: 'PLANNING' | 'HR' | 'PRODUCTION') => ({ access: resolveAccessContext([{ profile, departmentCode, scopeKey: departmentCode ? `DEPARTMENT:${departmentCode}` : 'GLOBAL', grantType: 'PRIMARY' }]) });
  assert.equal(canAdjustProductionDates(actor('ADMIN_GLOBAL')), true);
  assert.equal(canAdjustProductionDates(actor('DEPARTMENT_FULL', 'PLANNING')), true);
  assert.equal(canManageProductionControl({ access: resolveAccessContext([{ profile: 'WORKSHOP_SUPERVISOR', scopeKey: 'WORKSHOP:PRODUCTION', grantType: 'PRIMARY' }]) }), true);
  assert.equal(canAdjustProductionDates(actor('DEPARTMENT_FULL', 'PRODUCTION')), false);
  assert.equal(canManageProductionControl(actor('DEPARTMENT_FULL', 'HR')), false);
  assert.equal(canAdjustProductionDates(actor('PLANNING_COLLABORATOR')), false, 'collaboration is not the planning department');
});

test('customer risk stays visible through pauses while estimated delay is separately labelled', () => {
  const alerts = getProductionAlerts({ stage: 'frontend', plannedAt: '2026-08-20', estimatedCompletionAt: '2026-09-01', deliveryDay: '2026-08-25' }, new Date('2026-08-28T03:00:00Z'));
  assert.ok(alerts.some(item => item.code === 'OVERDUE' && item.label === '客户交期逾期3天'));
  assert.ok(!alerts.some(item => item.code === 'INTERNAL_PLAN_DELAY'));
  const unknownCustomer = getProductionAlerts({ stage: 'frontend', plannedAt: '2026-08-20' }, new Date('2026-08-28T03:00:00Z'));
  assert.ok(!unknownCustomer.some(item => item.code === 'OVERDUE'));
  assert.ok(unknownCustomer.some(item => item.code === 'INTERNAL_PLAN_DELAY'));
});

test('dispatch documents preserve selected order, independent note, pause, and original date basis with escaped print text', () => {
  const control = serializeProductionControl({ operationalNote: { text: '<端子缺料>', owner: '采购' }, productionPausedAt: '2026-08-28T02:00:00Z', productionPause: { reason: '等待来料' }, deliveryDay: '2026-09-04', deliveryBaselineDay: '2026-08-28', plannedAt: '2026-08-27', estimatedCompletionAt: '2026-09-02' });
  const rows = buildProductionDispatchDocumentRows([{ id: 'a', code: 'A' }, { id: 'b', code: 'B', deliveryDay: '2026-09-04', productionControl: control }], ['b']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].productionStatus, '已暂停');
  assert.match(rows[0].baselineDates, /2026-08-28/);
  assert.equal(rows[0].estimatedDate, '2026-09-02');
  const html = renderProductionDispatchPrintHtml({ rows });
  assert.match(html, /&lt;端子缺料&gt;/);
  assert.match(html, /暂停：等待来料/);
  assert.match(html, /<td>1<\/td>/);
});
