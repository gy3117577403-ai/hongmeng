import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertDailyPlanEnabled,
  DailyPlanDisabledError,
  dailyPlanEnabled,
} from '../lib/daily-plan-feature';

test('daily planning is disabled by default and requires an explicit true value', () => {
  const previous = process.env.DAILY_PLAN_ENABLED;
  try {
    delete process.env.DAILY_PLAN_ENABLED;
    assert.equal(dailyPlanEnabled(), false);
    for (const value of ['', ' ', '0', 'false', 'OFF', 'no', 'disabled', 'unexpected']) {
      process.env.DAILY_PLAN_ENABLED = value;
      assert.equal(dailyPlanEnabled(), false, value);
    }
    for (const value of ['1', 'true', 'ON', 'yes', 'enabled']) {
      process.env.DAILY_PLAN_ENABLED = value;
      assert.equal(dailyPlanEnabled(), true, value);
    }
  } finally {
    if (previous === undefined) delete process.env.DAILY_PLAN_ENABLED;
    else process.env.DAILY_PLAN_ENABLED = previous;
  }
});

test('disabled daily planning is surfaced as a not-found boundary', () => {
  const previous = process.env.DAILY_PLAN_ENABLED;
  try {
    process.env.DAILY_PLAN_ENABLED = 'false';
    assert.throws(
      () => assertDailyPlanEnabled(),
      (error: unknown) => error instanceof DailyPlanDisabledError
        && error.status === 404
        && error.code === 'DAILY_PLAN_DISABLED',
    );
  } finally {
    if (previous === undefined) delete process.env.DAILY_PLAN_ENABLED;
    else process.env.DAILY_PLAN_ENABLED = previous;
  }
});
