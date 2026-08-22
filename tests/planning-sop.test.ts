import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatPlanningSopUpdatedAt,
  normalizePlanningSopDrawingStatus,
  normalizePlanningSopStage,
  planningSopRequiresReleaseConfirmation,
  planningSopStage,
  planningSopTooltip,
} from '../lib/planning-sop';

test('normalizes only supported planning SOP metadata values', () => {
  assert.equal(normalizePlanningSopStage('standard'), 'standard');
  assert.equal(normalizePlanningSopStage('new_product'), 'new_product');
  assert.equal(normalizePlanningSopStage('validating'), 'validating');
  assert.equal(normalizePlanningSopStage('draft'), null);
  assert.equal(normalizePlanningSopDrawingStatus('available'), 'available');
  assert.equal(normalizePlanningSopDrawingStatus('missing'), 'missing');
  assert.equal(normalizePlanningSopDrawingStatus('unknown'), null);
  assert.equal(planningSopStage(null), 'unregistered');
});

test('requires an explicit release confirmation only for validating SOPs', () => {
  assert.equal(planningSopRequiresReleaseConfirmation('validating'), true);
  assert.equal(planningSopRequiresReleaseConfirmation('standard'), false);
  assert.equal(planningSopRequiresReleaseConfirmation('new_product'), false);
  assert.equal(planningSopRequiresReleaseConfirmation(null), false);
});

test('tooltip exposes file existence, lifecycle stage, remark, and update time together', () => {
  const tooltip = planningSopTooltip({
    sopFileCount: 0,
    sopStage: 'validating',
    sopDrawingStatus: 'available',
    sopRemark: '样品参数需验证',
    sopMetadataUpdatedAt: '2026-08-22T11:43:00.000Z',
  });
  assert.match(tooltip, /SOP文件：缺少有效文件/);
  assert.match(tooltip, /SOP状态：验证中/);
  assert.match(tooltip, /图纸状态：有图纸/);
  assert.match(tooltip, /备注：样品参数需验证/);
  assert.match(tooltip, /状态更新：2026-08-22 19:43/);
  assert.equal(formatPlanningSopUpdatedAt('invalid'), null);
});
