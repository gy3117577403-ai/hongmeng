import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDailyPlanTeamId } from '../lib/daily-plan-route-support';

test('daily plan mutation requires an explicit team instead of silently choosing the first team', async () => {
  await assert.rejects(
    resolveDailyPlanTeamId({ actorUserId: 'user-a', workDate: '2026-08-03', shiftCode: 'DAY' }),
    (error: unknown) => {
      const value = error as Error & { status?: number; code?: string };
      assert.equal(value.status, 409);
      assert.equal(value.code, 'DAILY_PLAN_TEAM_REQUIRED');
      assert.match(value.message, /选择具体生产班组/);
      return true;
    },
  );
});

test('daily plan mutation preserves an explicitly selected team', async () => {
  const result = await resolveDailyPlanTeamId({
    actorUserId: 'user-a',
    workDate: '2026-08-03',
    shiftCode: 'DAY',
    teamId: 'team-a',
  });
  assert.equal(result, 'team-a');
});
