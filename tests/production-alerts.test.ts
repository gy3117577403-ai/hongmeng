import assert from 'node:assert/strict';
import test from 'node:test';
import { getProductionAlerts } from '../lib/production-alerts';

test('normal drawing and material states do not create alerts', () => {
  const alerts = getProductionAlerts({
    specification: 'D019999-9087-V03', stage: 'backend', drawingStatus: '已发', materialStatus: '料齐',
    uncompletedQty: '3000', completedQty: '2000', plannedAt: '2099-01-01',
  });
  assert.deepEqual(alerts, []);

  const explicitIssuedDrawing = getProductionAlerts({
    specification: 'D019999-9087-V03', stage: 'not_issued', drawingStatus: '已发', materialStatus: '料齐',
    uncompletedQty: '3000', completedQty: '0', plannedAt: '2099-01-01',
  });
  assert.deepEqual(explicitIssuedDrawing, []);
});

test('sample confirmation and tail remaining are explicit alerts', () => {
  const drawing = getProductionAlerts({
    specification: 'D019999-9087-V03', stage: 'not_issued', drawingStatus: '待样品确认',
    uncompletedQty: '3000', completedQty: '0', plannedAt: '2099-01-01',
  });
  assert.equal(drawing[0]?.code, 'SAMPLE_CONFIRMATION_REQUIRED');

  const completed = getProductionAlerts({
    specification: 'D019999-9087-V03', stage: 'completed', drawingStatus: '已发', materialStatus: '料齐',
    uncompletedQty: '3000', completedQty: '2990',
  });
  assert.equal(completed[0]?.code, 'TAIL_REMAINING');
});
