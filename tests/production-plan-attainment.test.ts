import assert from 'node:assert/strict';
import test from 'node:test';
import {
  productionPlanAttainment,
  productionPlanAttainmentForScope,
} from '@/lib/production-plan-attainment';

test('production plan attainment is completed orders divided by total orders', () => {
  assert.deepEqual(productionPlanAttainment(3, 8), {
    totalOrders: 8,
    completedOrders: 3,
    percentage: 37.5,
  });
  assert.equal(productionPlanAttainment(0, 0).percentage, null);
  assert.equal(productionPlanAttainment(12, 10).percentage, 100);
});

test('current-week plan attainment excludes carryovers from the denominator', () => {
  const records = [
    { completed: true, weekStartDateKey: '2026-08-24' },
    ...Array.from({ length: 27 }, () => ({ completed: false, weekStartDateKey: '2026-08-24' })),
    ...Array.from({ length: 48 }, () => ({ completed: false, weekStartDateKey: '2026-08-17' })),
  ];
  assert.deepEqual(productionPlanAttainmentForScope(records, '2026-08-24'), {
    totalOrders: 28,
    completedOrders: 1,
    percentage: 3.6,
  });
  assert.deepEqual(productionPlanAttainmentForScope(records, null), {
    totalOrders: 76,
    completedOrders: 1,
    percentage: 1.3,
  });
});
