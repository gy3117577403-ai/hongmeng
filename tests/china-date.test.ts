import assert from 'node:assert/strict';
import test from 'node:test';
import { chinaDateKey } from '../lib/china-date';
import { parseWeek, ymd } from '../lib/weekly-work-orders';

test('China-local midnight keeps the intended calendar date', () => {
  const stored = new Date('2026-07-12T16:00:00.000Z');
  assert.equal(chinaDateKey(stored), '2026-07-13');
  assert.equal(ymd(stored), '2026-07-13');
});

test('serialized week date round-trips to the same stored instant', () => {
  const stored = new Date('2026-07-12T16:00:00.000Z');
  const serialized = chinaDateKey(stored);
  const parsed = parseWeek(serialized);
  assert.ok(parsed);
  assert.equal(parsed?.toISOString(), stored.toISOString());
});

test('invalid or missing dates serialize to an empty date key', () => {
  assert.equal(chinaDateKey(null), '');
  assert.equal(chinaDateKey(new Date('invalid')), '');
});
