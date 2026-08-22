import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeProductTimeDraftWithPublished,
  type ProductTimeDraftMergeEntry,
} from '@/lib/product-time-draft-sync';

function entry(
  occurrenceKey: string,
  position: number,
  unitMilliseconds = 1_000,
  sequenceGroup = position,
): ProductTimeDraftMergeEntry {
  return {
    processDefinitionId: `definition-${occurrenceKey}`,
    occurrenceKey,
    position,
    sequenceGroup,
    timeBasis: 'per_unit',
    unitMilliseconds,
    actionMilliseconds: null,
    occurrences: 1,
    setupMilliseconds: 0,
    unitLabel: '套',
    reportQuantityBasis: 'product',
    reportUnitLabel: '个',
    countsForEfficiency: true,
    isCritical: false,
    remark: null,
  };
}

test('syncs published-only operation and time updates while preserving draft edits', () => {
  const base = [entry('A', 1), entry('C', 2)];
  const draft = [entry('A', 1, 1_500), entry('C', 2)];
  const published = [entry('A', 1), entry('B', 2, 800), entry('C', 3, 3_000)];

  const result = mergeProductTimeDraftWithPublished({
    baseEntries: base,
    draftEntries: draft,
    publishedEntries: published,
  });

  assert.deepEqual(result.entries.map(item => item.occurrenceKey), ['A', 'B', 'C']);
  assert.equal(result.entries.find(item => item.occurrenceKey === 'A')?.unitMilliseconds, 1_500);
  assert.equal(result.entries.find(item => item.occurrenceKey === 'C')?.unitMilliseconds, 3_000);
  assert.equal(result.summary.addedFromPublished, 1);
  assert.equal(result.summary.updatedFromPublished, 1);
  assert.equal(result.summary.preservedDraftChanges, 1);
  assert.deepEqual(result.summary.conflicts, []);
});
test('keeps the draft value and reports a conflict when both sides changed the same field', () => {
  const base = [entry('A', 1, 1_000)];
  const draft = [entry('A', 1, 1_500)];
  const published = [entry('A', 1, 2_000)];

  const result = mergeProductTimeDraftWithPublished({
    baseEntries: base,
    draftEntries: draft,
    publishedEntries: published,
  });

  assert.equal(result.entries[0].unitMilliseconds, 1_500);
  assert.equal(result.summary.conflicts.length, 1);
  assert.equal(result.summary.conflicts[0].kind, 'FIELDS_CHANGED_ON_BOTH_SIDES');
  assert.deepEqual(result.summary.conflicts[0].fields, ['unitMilliseconds']);
  assert.equal(result.summary.conflicts[0].resolution, 'draft_preserved');
});

test('adopts a published deletion only when the draft did not edit the removed operation', () => {
  const base = [entry('A', 1), entry('B', 2), entry('C', 3)];
  const unchangedDraft = base.map(item => ({ ...item }));
  const changedDraft = [entry('A', 1), entry('B', 2, 1_500), entry('C', 3)];
  const published = [entry('A', 1), entry('C', 2)];

  const adopted = mergeProductTimeDraftWithPublished({
    baseEntries: base,
    draftEntries: unchangedDraft,
    publishedEntries: published,
  });
  assert.deepEqual(adopted.entries.map(item => item.occurrenceKey), ['A', 'C']);
  assert.equal(adopted.summary.removedFromPublished, 1);
  assert.deepEqual(adopted.summary.conflicts, []);

  const preserved = mergeProductTimeDraftWithPublished({
    baseEntries: base,
    draftEntries: changedDraft,
    publishedEntries: published,
  });
  assert.deepEqual(preserved.entries.map(item => item.occurrenceKey), ['A', 'B', 'C']);
  assert.equal(preserved.summary.conflicts[0].kind, 'PUBLISHED_DELETED_DRAFT_CHANGED');
});

test('preserves the published parallel group when inserting a new operation', () => {
  const base = [entry('A', 1, 1_000, 1), entry('C', 2, 1_000, 2)];
  const published = [
    entry('A', 1, 1_000, 1),
    entry('B', 2, 800, 1),
    entry('C', 3, 1_000, 2),
  ];

  const result = mergeProductTimeDraftWithPublished({
    baseEntries: base,
    draftEntries: base.map(item => ({ ...item })),
    publishedEntries: published,
  });

  assert.deepEqual(result.entries.map(item => item.occurrenceKey), ['A', 'B', 'C']);
  assert.deepEqual(result.entries.map(item => item.sequenceGroup), [1, 1, 2]);
});
