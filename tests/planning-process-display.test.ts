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
