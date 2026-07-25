import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyHomeDashboardData } from '../lib/home-dashboard';

test('empty home dashboard preserves the four operational workstreams', () => {
  const data = emptyHomeDashboardData('temporarily unavailable', new Date('2026-07-25T02:00:00.000Z'));

  assert.deepEqual(
    data.workstreams.map(stream => stream.id),
    ['production', 'warehouse', 'material', 'labor'],
  );
  assert.deepEqual(
    data.workstreams.map(stream => stream.count),
    [0, 0, 0, 0],
  );
  assert.match(data.workstreams[0].route, /^\/production/);
  assert.match(data.workstreams[1].route, /^\/workspace\/warehouse/);
  assert.match(data.workstreams[2].route, /^\/workspace\/procurement/);
  assert.match(data.workstreams[3].route, /^\/workspace\/reports\?view=labor/);
});
