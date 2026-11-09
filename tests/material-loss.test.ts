import test from 'node:test';
import assert from 'node:assert/strict';
import { lossFields, lossQuantity, lossDay, lossCsvCell } from '../lib/material-loss-domain';
import { expandModulePermissions, moduleLevel } from '../lib/module-permissions';
import { resolveAccessContext } from '../lib/department-access';
import { canAccessApiRoute } from '../lib/api-route-access';
import { canAccessAppRoute } from '../lib/app-route-access';
import { sampleCustomerLabel, sampleDisplayDate, isSampleCustomerDate } from '../lib/sample-display';
import { parseSamplePlanRow, SAMPLE_PLAN_IMPORT_HEADERS } from '../lib/sample-plan-import';

const access = (key: string, level = 'COLLABORATE') => resolveAccessContext([{ profile: 'MODULE_ACCESS', grantType: 'PRIMARY', scopeKey: 'MODULES:ON' }, { profile: 'MODULE_ACCESS', grantType: 'CONCURRENT', scopeKey: `MODULE:${key}:${level}` }]);
test('loss grants are opt-in, independent and never grant warehouse or hours approval', () => {
  const parent = expandModulePermissions({ materials: 'COLLABORATE' });
  assert.equal(parent.warehouse, 'COLLABORATE');
  assert.equal(parent['material-loss-report'], undefined); assert.equal(parent['material-loss-approval'], undefined);
  for (const key of ['material-loss-report', 'material-loss-approval']) {
    for (const level of ['READ', 'COLLABORATE']) {
      const a = access(key, level);
      assert.equal(canAccessAppRoute(a, '/workspace/material-loss?id=x'), true);
      assert.equal(canAccessApiRoute(a, '/api/material-loss/x', 'PATCH'), level === 'COLLABORATE');
      assert.equal(a.capabilities.includes('WAREHOUSE:UPDATE'), false);
      assert.equal(canAccessApiRoute(a, '/api/other-work-times/x', 'PATCH'), false);
      assert.equal(canAccessApiRoute(a, '/api/purchases', 'POST'), false);
      assert.equal(moduleLevel(a, key === 'material-loss-report' ? 'material-loss-approval' : 'material-loss-report'), undefined);
    }
  }
  const oldAdmin = resolveAccessContext([{ profile: 'ADMIN_GLOBAL', grantType: 'PRIMARY', scopeKey: 'GLOBAL' }]);
  assert.equal(canAccessAppRoute(oldAdmin, '/workspace/material-loss'), false);
  assert.equal(canAccessApiRoute(oldAdmin, '/api/material-loss', 'POST'), false);
});
test('drafts can be incomplete, submitted losses require facts and use precise positive quantities', () => {
  assert.equal(lossFields({}).quantity, null);
  assert.throws(() => lossFields({}, true));
  for (const v of [0, -1, 'NaN', 'Infinity', '1e3', '0.0000001', true, '1000000000000']) assert.throws(() => lossQuantity(v));
  assert.equal(lossQuantity('1.250001'), '1.250001');
  assert.equal(lossQuantity('999999999999.123456'), '999999999999.123456');
  assert.equal(lossQuantity('00003.250000'), '3.25');
  assert.equal(lossQuantity('0', false, true), '0');
  assert.throws(() => lossDay('2026-02-30', '损耗'));
  assert.throws(() => lossFields({ occurredOn: '2999-01-01' }));
  assert.throws(() => lossFields({ materialName: '端子', materialModel: 'T1', unit: '个', quantity: 1, occurredOn: '2026-10-29', reason: '调机损耗', needReplenishment: true }, true));
  assert.equal(lossCsvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"');
});
test('sample dates never expose JS Date strings or guess a customer identity', () => {
  const legacy = 'Thu Oct 29 2026 00:00:00 GMT+0000 (Coordinated Universal Time)';
  assert.equal(sampleDisplayDate(legacy), '2026-10-29');
  assert.equal(sampleDisplayDate('2026-10-28T20:00:00Z'), '2026-10-29');
  assert.equal(sampleDisplayDate('not a date'), '未设置');
  assert.equal(sampleCustomerLabel(legacy), '客户待核对（原值 2026-10-29）');
  assert.equal(sampleCustomerLabel('杭州电章鱼'), '杭州电章鱼');
  assert.equal(isSampleCustomerDate(new Date('2026-10-29')), true);
  const columns = Object.fromEntries(SAMPLE_PLAN_IMPORT_HEADERS.map((h, i) => [h, i]));
  const result = parseSamplePlanRow([new Date('2026-10-29'), '产品', 'T10', 'A', 3, '2026-11-06'], 2, columns);
  assert.ok(result.errors.some(e => e.includes('客户名称列是日期')));
});
