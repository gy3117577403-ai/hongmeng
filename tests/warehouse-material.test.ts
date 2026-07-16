import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWeeklyPlanPreview } from '../lib/work-order-import';
import {
  prepareWarehouseTaskTransition,
  warehouseLegacyMaterialStatus,
  type WarehouseTaskTransitionState,
} from '../lib/warehouse-material';

function state(status: WarehouseTaskTransitionState['status'] = 'pending'): WarehouseTaskTransitionState {
  return { status, exceptionType: null, exceptionNote: null, expectedAt: null, completedAt: null };
}

test('weekly plan import always starts warehouse preparation as pending', () => {
  const rows = buildWeeklyPlanPreview({
    headers: ['客户名称', '品名', '规格', '图纸', '配料'],
    rows: [['测试客户', '测试产品', 'SPEC-001', '已发', '已配料']],
    startRowNo: 2,
    weekStartDate: '2026-07-20',
    sourceSheetName: '周计划',
    existingCodes: new Set<string>(),
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'ready');
  assert.equal(rows[0].workOrder.stage, 'frontend');
  assert.equal(rows[0].workOrder.materialStatus, '未配料');
});

test('pending material task can be completed without changing production stage', () => {
  const now = new Date('2026-07-16T04:00:00.000Z');
  const result = prepareWarehouseTaskTransition(state(), { action: 'complete' }, now);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.next.status, 'completed');
  assert.equal(result.next.completedAt, now);
  assert.equal(warehouseLegacyMaterialStatus(result.next), '已配料');
});

test('shortage requires an expected arrival date', () => {
  const result = prepareWarehouseTaskTransition(state(), {
    action: 'report_exception', exceptionType: 'shortage', exceptionNote: '端子不足',
  }, new Date('2026-07-16T04:00:00.000Z'));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /预计到料时间/);
});

test('warehouse exception records type, note and expected date', () => {
  const result = prepareWarehouseTaskTransition(state(), {
    action: 'report_exception', exceptionType: 'shortage', exceptionNote: '端子不足 500 套', expectedAt: '2026-07-18',
  }, new Date('2026-07-16T04:00:00.000Z'));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.next.status, 'exception');
  assert.equal(result.next.exceptionType, 'shortage');
  assert.match(warehouseLegacyMaterialStatus(result.next), /^缺料/);
});

test('exception resolution requires a traceable note', () => {
  const current: WarehouseTaskTransitionState = {
    status: 'exception', exceptionType: 'wrong_material', exceptionNote: '端子型号错误', expectedAt: null, completedAt: null,
  };
  const missing = prepareWarehouseTaskTransition(current, { action: 'resolve', resolution: 'completed' });
  assert.equal(missing.ok, false);
  const resolved = prepareWarehouseTaskTransition(current, { action: 'resolve', resolution: 'completed', note: '已更换并复核' });
  assert.equal(resolved.ok, true);
  if (resolved.ok) assert.equal(resolved.next.status, 'completed');
});

test('completed task needs a reason before reopening', () => {
  const completed = state('completed');
  const missing = prepareWarehouseTaskTransition(completed, { action: 'reopen' });
  assert.equal(missing.ok, false);
  const reopened = prepareWarehouseTaskTransition(completed, { action: 'reopen', note: '复核发现料号不符' });
  assert.equal(reopened.ok, true);
  if (reopened.ok) assert.equal(reopened.next.status, 'pending');
});
