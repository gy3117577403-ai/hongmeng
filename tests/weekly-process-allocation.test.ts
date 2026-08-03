import assert from 'node:assert/strict';
import test from 'node:test';
import {
  summarizeWeeklyProcessAllocation,
  weeklyProcessTeamEligible,
} from '../lib/weekly-process-allocation';

test('weekly allocations subtract daily splits without double-counting actual production', () => {
  assert.deepEqual(summarizeWeeklyProcessAllocation({
    batchQuantity: 100,
    processedQuantity: 30,
    plannedQuantities: [20, 25],
  }), {
    batchQuantity: 100,
    processedQuantity: 30,
    allocatedQuantity: 45,
    coveredQuantity: 45,
    remainingQuantity: 55,
  });
});

test('actual progress is used when it is ahead of daily allocations', () => {
  assert.equal(summarizeWeeklyProcessAllocation({
    batchQuantity: 100,
    processedQuantity: 70,
    plannedQuantities: [20, 25],
  }).remainingQuantity, 30);
});

test('legacy over-allocation is clamped and never creates a negative remainder', () => {
  assert.equal(summarizeWeeklyProcessAllocation({
    batchQuantity: 100,
    processedQuantity: 0,
    plannedQuantities: [70, 70],
  }).remainingQuantity, 0);
});

test('process ownership can be configured gradually without hiding unmapped work', () => {
  const globallyOwned = new Set(['cutting']);
  assert.equal(weeklyProcessTeamEligible({
    processDefinitionId: 'cutting',
    teamProcessDefinitionIds: new Set(['cutting']),
    globallyOwnedProcessDefinitionIds: globallyOwned,
  }), true);
  assert.equal(weeklyProcessTeamEligible({
    processDefinitionId: 'cutting',
    teamProcessDefinitionIds: new Set(),
    globallyOwnedProcessDefinitionIds: globallyOwned,
  }), false);
  assert.equal(weeklyProcessTeamEligible({
    processDefinitionId: 'pressing',
    teamProcessDefinitionIds: new Set(),
    globallyOwnedProcessDefinitionIds: globallyOwned,
  }), true);
});
