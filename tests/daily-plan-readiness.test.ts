import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dailyPlanWarningTexts,
  displayTeamCode,
  drawingReady,
} from '../lib/daily-plan-readiness';

test('machine readiness codes are never exposed as user-facing labels', () => {
  assert.deepEqual(dailyPlanWarningTexts(['DRAWING_NOT_READY', 'MATERIAL_NOT_READY']), {
    codes: ['DRAWING_NOT_READY', 'MATERIAL_NOT_READY'],
    labels: ['图纸尚未下发或确认', '物料尚未备齐'],
  });
});

test('drawing requires both a library item and a released status', () => {
  assert.equal(drawingReady({ drawingLibraryItemId: 'drawing-1', drawingStatus: 'issued' }), true);
  assert.equal(drawingReady({ drawingLibraryItemId: 'drawing-1', drawingStatus: '已发' }), true);
  assert.equal(drawingReady({ drawingLibraryItemId: 'drawing-1', drawingStatus: '已确认' }), true);
  assert.equal(drawingReady({ drawingLibraryItemId: 'drawing-1', drawingStatus: 'draft' }), false);
  assert.equal(drawingReady({ drawingLibraryItemId: 'drawing-1', drawingStatus: '待发' }), false);
  assert.equal(drawingReady({ drawingStatus: 'issued' }), false);
});

test('bootstrap team codes remain internal while human codes stay visible', () => {
  assert.equal(displayTeamCode('LEGACY_5BFAAB074987'), null);
  assert.equal(displayTeamCode('TEAM-12ABCDEF'), null);
  assert.equal(displayTeamCode('PRESS-A'), 'PRESS-A');
});
