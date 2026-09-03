import assert from 'node:assert/strict';
import test from 'node:test';
import { planningProcessDisplay } from '../lib/planning-process-display';

test('draft plan with a published product profile is shown as linked, not missing', () => {
  assert.deepEqual(planningProcessDisplay({
    processStatus: 'not_created',
    productTimeProfileVersion: 3,
  }), {
    label: '已关联 V3',
    detail: '下达后自动生成',
    readiness: 'registered',
  });
});

test('unpublished product time remains visibly pending', () => {
  assert.equal(planningProcessDisplay({
    processStatus: 'not_created',
    productTimeProfileVersion: null,
  }).label, '工时待发布');
});

test('actual route state wins after release', () => {
  assert.equal(planningProcessDisplay({
    processStatus: 'confirmed',
    productTimeProfileVersion: 2,
  }).label, '已确认');
  assert.equal(planningProcessDisplay({
    processStatus: 'completed',
    productTimeProfileVersion: 2,
  }).label, '已完成');
});

test('draft route never pretends to be actively syncing without a real job state', () => {
  assert.deepEqual(planningProcessDisplay({
    processStatus: 'draft',
    productTimeProfileVersion: 1,
    routeSource: 'product_time_profile',
    routeProductTimeProfileVersion: 1,
  }), {
    label: '路线待确认',
    detail: '工艺 V1 已写入，等待自动修复',
    readiness: 'pending',
  });
  assert.deepEqual(planningProcessDisplay({
    processStatus: 'draft',
    productTimeProfileVersion: 2,
    routeSource: 'product_time_pending',
    routeProductTimeProfileVersion: null,
  }), {
    label: '工艺待同步',
    detail: '产品工时 V2 已发布',
    readiness: 'pending',
  });
});
