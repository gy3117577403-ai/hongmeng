import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHttpByteRange } from '../lib/http-byte-range';

test('HTTP byte ranges support bounded, open, and suffix reads', () => {
  assert.deepEqual(parseHttpByteRange('bytes=0-99', 1000), { start: 0, end: 99, length: 100 });
  assert.deepEqual(parseHttpByteRange('bytes=900-', 1000), { start: 900, end: 999, length: 100 });
  assert.deepEqual(parseHttpByteRange('bytes=-50', 1000), { start: 950, end: 999, length: 50 });
  assert.deepEqual(parseHttpByteRange('bytes=900-2000', 1000), { start: 900, end: 999, length: 100 });
});

test('HTTP byte ranges reject multiple or unsatisfiable ranges', () => {
  assert.equal(parseHttpByteRange('bytes=1000-', 1000), 'invalid');
  assert.equal(parseHttpByteRange('bytes=9-2', 1000), 'invalid');
  assert.equal(parseHttpByteRange('bytes=0-1,4-5', 1000), 'invalid');
  assert.equal(parseHttpByteRange('items=0-1', 1000), 'invalid');
});

