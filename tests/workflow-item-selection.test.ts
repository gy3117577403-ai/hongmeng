import assert from 'node:assert/strict';
import test from 'node:test';
import { selectWorkflowItem } from '../lib/workflow-item-selection';

const items = [
  { id: 'first', batchId: 'batch-1', workOrderId: 'work-order-1' },
  { id: 'second', batchId: 'batch-2', workOrderId: 'work-order-2' },
];

test('an exact workflow work-order deep link wins over a remembered selection', () => {
  assert.equal(selectWorkflowItem({
    items,
    workOrderId: 'work-order-2',
    preferredId: 'first',
  })?.id, 'second');
});

test('a missing deep-link target never falls back to an unrelated first work order', () => {
  assert.equal(selectWorkflowItem({
    items,
    workOrderId: 'missing-work-order',
    preferredId: 'first',
  }), null);
});

test('ordinary workflow navigation still restores a remembered item or the first result', () => {
  assert.equal(selectWorkflowItem({ items, preferredId: 'second' })?.id, 'second');
  assert.equal(selectWorkflowItem({ items, preferredId: 'missing' })?.id, 'first');
});
