export class DailyPlanDisabledError extends Error {
  readonly status = 404;
  readonly code = 'DAILY_PLAN_DISABLED';

  constructor() {
    super('日计划中心当前未启用');
    this.name = 'DailyPlanDisabledError';
  }
}

export function dailyPlanEnabled(value = process.env.DAILY_PLAN_ENABLED): boolean {
  if (value === undefined || value === null || value.trim() === '') return false;
  return new Set(['1', 'true', 'on', 'yes', 'enabled']).has(value.trim().toLowerCase());
}

export function assertDailyPlanEnabled(): void {
  if (!dailyPlanEnabled()) throw new DailyPlanDisabledError();
}
