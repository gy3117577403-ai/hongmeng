import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeWipApiValue } from '../lib/wip-api-serialization';

test('WIP mutation responses serialize exact bigint values and dates before JSON output', () => {
  const value = serializeWipApiValue({
    plannedStandardMilliseconds: 12_000n,
    scheduledAt: new Date('2026-08-31T12:00:00.000Z'),
    steps: [{ plannedStandardMilliseconds: 8_000n }],
  });

  assert.deepEqual(value, {
    plannedStandardMilliseconds: '12000',
    scheduledAt: '2026-08-31T12:00:00.000Z',
    steps: [{ plannedStandardMilliseconds: '8000' }],
  });
  assert.doesNotThrow(() => JSON.stringify(value));
});
