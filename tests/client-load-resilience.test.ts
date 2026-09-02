import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  AUTO_REFRESH_BASE_DELAY_MS,
  AUTO_REFRESH_MAX_DELAY_MS,
  auxiliaryValueAfterLoad,
  autoRefreshDelayMs,
  cacheBoundSnapshotValue,
  retainCacheBoundSnapshot,
  shouldStartAutoRefresh,
} from '../lib/client-load-resilience';

const repositoryRoot = resolve(import.meta.dirname, '..');

test('auto refresh exponentially backs off after consecutive failures and caps at five minutes', () => {
  assert.equal(autoRefreshDelayMs(0), AUTO_REFRESH_BASE_DELAY_MS);
  assert.equal(autoRefreshDelayMs(1), 60_000);
  assert.equal(autoRefreshDelayMs(2), 120_000);
  assert.equal(autoRefreshDelayMs(3), 240_000);
  assert.equal(autoRefreshDelayMs(4), AUTO_REFRESH_MAX_DELAY_MS);
  assert.equal(autoRefreshDelayMs(20), AUTO_REFRESH_MAX_DELAY_MS);
});

test('auto refresh does not start while hidden, before backoff expires, or while another request is active', () => {
  const now = 1_000_000;
  assert.equal(shouldStartAutoRefresh({ visible: false, requestInFlight: false, now, nextAllowedAt: now }), false);
  assert.equal(shouldStartAutoRefresh({ visible: true, requestInFlight: true, now, nextAllowedAt: now }), false);
  assert.equal(shouldStartAutoRefresh({ visible: true, requestInFlight: false, now, nextAllowedAt: now + 1 }), false);
  assert.equal(shouldStartAutoRefresh({ visible: true, requestInFlight: false, now, nextAllowedAt: now }), true);
});

test('production snapshots are retained only for the exact active query key', () => {
  const snapshot = { cacheKey: 'scope=current&keyword=610', value: { total: 3 } };
  assert.deepEqual(cacheBoundSnapshotValue(snapshot, 'scope=current&keyword=610'), { total: 3 });
  assert.equal(cacheBoundSnapshotValue(snapshot, 'scope=next&keyword=610'), null);
  assert.equal(retainCacheBoundSnapshot(snapshot, 'scope=current&keyword=610'), snapshot);
  assert.equal(retainCacheBoundSnapshot(snapshot, 'scope=current&keyword=611'), null);
});

test('planning auxiliary options retain only the dataset named by its warning code', () => {
  const previousProducts = [{ id: 'product-1' }];
  const previousSalespeople = ['业务员甲'];
  const productWarnings = [{ code: 'PLANNING_PRODUCT_OPTIONS_UNAVAILABLE' }];
  assert.equal(auxiliaryValueAfterLoad(previousProducts, [], productWarnings, 'PLANNING_PRODUCT_OPTIONS_UNAVAILABLE'), previousProducts);
  assert.deepEqual(auxiliaryValueAfterLoad(previousSalespeople, ['业务员乙'], productWarnings, 'PLANNING_SALESPEOPLE_UNAVAILABLE'), ['业务员乙']);
  const salespersonWarnings = [{ code: 'PLANNING_SALESPEOPLE_UNAVAILABLE' }];
  assert.deepEqual(auxiliaryValueAfterLoad(previousProducts, [{ id: 'product-2' }], salespersonWarnings, 'PLANNING_PRODUCT_OPTIONS_UNAVAILABLE'), [{ id: 'product-2' }]);
  assert.equal(auxiliaryValueAfterLoad(previousSalespeople, [], salespersonWarnings, 'PLANNING_SALESPEOPLE_UNAVAILABLE'), previousSalespeople);
  assert.deepEqual(auxiliaryValueAfterLoad(previousProducts, [], [], 'PLANNING_PRODUCT_OPTIONS_UNAVAILABLE'), []);
});

test('planning center distinguishes a failed first load from a genuine empty plan', () => {
  const source = readFileSync(resolve(repositoryRoot, 'components/PlanningCenterShell.tsx'), 'utf8');
  assert.match(source, /const \[planLoadError, setPlanLoadError\]/);
  assert.match(source, /warnings\?: ClientLoadWarning\[\]/);
  assert.match(source, /planningProductOptionsWarningCode/);
  assert.match(source, /planningSalespeopleWarningCode/);
  assert.match(source, /setProductOptions\(current => auxiliaryValueAfterLoad/);
  assert.match(source, /setSalespeople\(current => auxiliaryValueAfterLoad/);
  assert.match(source, /planning-auxiliary-warning/);
  assert.match(source, /计划数据已正常加载/);
  assert.match(source, /const planRefreshPendingRef = useRef\(false\)/);
  assert.match(source, /planRefreshPendingRef\.current = true/);
  assert.match(source, /if \(planRefreshPendingRef\.current\)/);
  assert.match(source, /planRefreshPendingRef\.current = false/);
  assert.match(source, /const planDataAvailable = lastPlanLoadedAt !== null/);
  assert.match(source, /数据加载失败，尚未获取到计划数据/);
  assert.match(source, /未获取到最新数据，当前保留/);
  assert.match(source, /planDataAvailable \? orderPool\.length : '—'/);
  assert.match(source, /: '排产数据未获取'/);
  assert.match(source, /!loading && planDataAvailable && !scheduleRows\.length/);
  assert.match(source, /!loading && planDataAvailable && !filteredOrders\.length/);
});

test('production execution keeps a prior board on refresh failure and never presents a failed first load as empty', () => {
  const source = readFileSync(resolve(repositoryRoot, 'components/ProductionExecutionCenter.tsx'), 'utf8');
  assert.match(source, /const \[loadError, setLoadError\]/);
  assert.match(source, /fetchProductionBoardPage\(params, controller\.signal\)/);
  assert.match(source, /includeSummary: false/);
  assert.doesNotMatch(source, /remainingOffsets/);
  assert.match(source, /cacheBoundSnapshotValue\(boardSnapshot, activeBoardCacheKey\)/);
  assert.match(source, /retainCacheBoundSnapshot\(current, cacheKey\)/);
  assert.match(source, /summary\?\.navigation\?\.current\?\.count/);
  assert.doesNotMatch(source, /summary\?\.navigation\.(?:current|next|afterNext|history|carryoverCount|olderCarryoverCount)/);
  assert.match(source, /board \? '未获取到最新数据' : '数据加载失败'/);
  assert.match(source, /!loading && board && !board\.items\.length/);
  assert.match(source, /shouldStartAutoRefresh/);
  assert.match(source, /autoRefreshDelayMs\(failures\)/);
});
