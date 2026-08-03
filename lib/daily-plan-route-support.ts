type UnknownRecord = Record<string, unknown>;

export function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

export function asOptionalString(value: unknown): string | undefined {
  const result = asString(value);
  return result || undefined;
}

export function asNumber(value: unknown, fallback = 0): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

export function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(item => asString(item)).filter(Boolean);
}

export async function resolveDailyPlanTeamId(input: {
  actorUserId: string;
  workDate: string;
  shiftCode?: string;
  teamId?: string;
}): Promise<string> {
  if (input.teamId) return input.teamId;
  const error = new Error('请先选择具体生产班组，再生成或确认日计划') as Error & {
    status?: number;
    code?: string;
  };
  error.status = 409;
  error.code = 'DAILY_PLAN_TEAM_REQUIRED';
  throw error;
}
