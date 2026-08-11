import assert from 'node:assert/strict';
import test from 'node:test';
import {
  insertProductTimeRouteEntry,
  moveProductTimeRouteGroupBefore,
  moveProductTimeRouteGroupByDirection,
  productTimeRouteGroups,
  removeProductTimeRouteEntry,
  reorderProductTimeRouteGroup,
} from '@/lib/product-time-route-editor';

type Entry = {
  occurrenceKey: string;
  parallelWithPrevious: boolean;
  name: string;
};

function entry(name: string, parallelWithPrevious = false): Entry {
  return { occurrenceKey: name, parallelWithPrevious, name };
}

test('inserts a missing operation at an exact route boundary', () => {
  const current = [entry('裁线'), entry('压接'), entry('包装')];
  const next = insertProductTimeRouteEntry(current, entry('检验'), '包装');
  assert.deepEqual(next.map(item => item.name), ['裁线', '压接', '检验', '包装']);
  assert.deepEqual(next.map(item => item.parallelWithPrevious), [false, false, false, false]);
});

test('can add an operation to the previous parallel group without splitting the next group', () => {
  const current = [
    entry('裁线'),
    entry('压接'),
    entry('拉力', true),
    entry('包装'),
  ];
  const next = insertProductTimeRouteEntry(current, entry('外观'), '包装', true);
  assert.deepEqual(next.map(item => item.name), ['裁线', '压接', '拉力', '外观', '包装']);
  assert.deepEqual(next.map(item => item.parallelWithPrevious), [false, false, true, true, false]);
});

test('moves a parallel group as one unit to an exact position', () => {
  const current = [
    entry('裁线'),
    entry('压接'),
    entry('拉力', true),
    entry('检验'),
    entry('包装'),
  ];
  const next = moveProductTimeRouteGroupBefore(current, '拉力', '包装');
  assert.deepEqual(next.map(item => item.name), ['裁线', '检验', '压接', '拉力', '包装']);
  assert.deepEqual(next.map(item => item.parallelWithPrevious), [false, false, false, true, false]);
});

test('drag reorder preserves occurrence keys and parallel grouping', () => {
  const current = [entry('A'), entry('B'), entry('C', true), entry('D')];
  const next = reorderProductTimeRouteGroup(current, 'B', 'A');
  assert.deepEqual(next.map(item => item.occurrenceKey), ['B', 'C', 'A', 'D']);
  assert.deepEqual(next.map(item => item.parallelWithPrevious), [false, true, false, false]);
  assert.deepEqual(productTimeRouteGroups(next).map(group => group.entries.map(item => item.name)), [
    ['B', 'C'],
    ['A'],
    ['D'],
  ]);
});

test('arrow movement moves the full parallel group instead of breaking it', () => {
  const current = [entry('A'), entry('B'), entry('C', true), entry('D')];
  const next = moveProductTimeRouteGroupByDirection(current, 'C', 1);
  assert.deepEqual(next.map(item => item.name), ['A', 'D', 'B', 'C']);
  assert.deepEqual(next.map(item => item.parallelWithPrevious), [false, false, false, true]);
});

test('removing a parallel group leader promotes the next member to group leader', () => {
  const current = [entry('A'), entry('B'), entry('C', true), entry('D')];
  const next = removeProductTimeRouteEntry(current, 'B');
  assert.deepEqual(next.map(item => item.name), ['A', 'C', 'D']);
  assert.deepEqual(next.map(item => item.parallelWithPrevious), [false, false, false]);
});
