import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasEffectiveIssuedDrawing,
  productionDrawingStageLabel,
  shouldSynchronizeDrawingReleaseStatus,
} from '../lib/production-drawing-readiness';

test('an original drawing is the safe fallback for legacy empty status', () => {
  assert.equal(hasEffectiveIssuedDrawing(null, true), true);
  assert.equal(hasEffectiveIssuedDrawing('未设置', true), true);
  assert.equal(hasEffectiveIssuedDrawing(null, false), false);
});

test('explicit pending and business hold statuses are preserved', () => {
  assert.equal(hasEffectiveIssuedDrawing('待发', true), true);
  assert.equal(hasEffectiveIssuedDrawing('待发', false), false);
  assert.equal(shouldSynchronizeDrawingReleaseStatus('待发'), true);
  assert.equal(shouldSynchronizeDrawingReleaseStatus('待样品确认'), false);
  assert.equal(shouldSynchronizeDrawingReleaseStatus('客户确认中'), false);
  assert.equal(shouldSynchronizeDrawingReleaseStatus('图纸变更'), false);
});

test('not-issued stage labels reflect drawing readiness and plan activation', () => {
  assert.equal(productionDrawingStageLabel({
    drawingStatus: null,
    hasOriginalDrawing: false,
    planActive: true,
  }), '等待图纸');
  assert.equal(productionDrawingStageLabel({
    drawingStatus: null,
    hasOriginalDrawing: true,
    planActive: true,
  }), '待开始首道工序');
  assert.equal(productionDrawingStageLabel({
    drawingStatus: null,
    hasOriginalDrawing: true,
    planActive: false,
  }), '图纸已就绪 · 待启用');
});
