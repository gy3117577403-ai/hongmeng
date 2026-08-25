import assert from 'node:assert/strict';
import test from 'node:test';
import { productionPlanAttainment } from '@/lib/production-plan-attainment';

test('production plan attainment is completed orders divided by total orders', () => {
  assert.deepEqual(productionPlanAttainment(3, 8), {
    totalOrders: 8,
    completedOrders: 3,
    percentage: 37.5,
  });
  assert.equal(productionPlanAttainment(0, 0).percentage, null);
  assert.equal(productionPlanAttainment(12, 10).percentage, 100);
});
