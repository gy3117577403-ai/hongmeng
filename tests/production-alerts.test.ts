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

test('warehouse pending and completed states stay silent in production', () => {
  for (const warehouseMaterialStatus of ['pending', 'completed']) {
    const alerts = getProductionAlerts({
      specification: 'D019999-9087-V03', stage: 'frontend', drawingStatus: '已发',
      materialStatus: warehouseMaterialStatus === 'pending' ? '未配料' : '已配料',
      warehouseMaterialStatus, uncompletedQty: '3000', completedQty: '0', plannedAt: '2099-01-01',
    });
    assert.equal(alerts.some(alert => alert.code === 'MATERIAL_NOT_READY'), false);
  }
});

test('only an unresolved warehouse exception is shown with expected arrival', () => {
  const alerts = getProductionAlerts({
    specification: 'D019999-9087-V03', stage: 'frontend', drawingStatus: '已发',
    warehouseMaterialStatus: 'exception', warehouseExceptionType: 'shortage',
    warehouseExceptionNote: '端子库存不足', warehouseExpectedAt: '2026-07-18T04:00:00.000Z',
    uncompletedQty: '3000', completedQty: '0', plannedAt: '2099-01-01',
  }, new Date('2026-07-16T04:00:00.000Z'));
  const warehouse = alerts.find(alert => alert.code === 'MATERIAL_NOT_READY');
  assert.equal(warehouse?.label, '缺料 · 预计7月18日到');
  assert.equal(warehouse?.tone, 'orange');
});
