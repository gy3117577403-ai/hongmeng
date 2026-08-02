import { getDailyPlanWorkbench } from '@/lib/daily-plan-service';

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
  const workbench = await getDailyPlanWorkbench({
    actorUserId: input.actorUserId,
    workDate: input.workDate,
    shiftCode: input.shiftCode,
  }) as UnknownRecord;
  const teams = Array.isArray(workbench.teams) ? workbench.teams : [];
  const firstTeam = asRecord(teams[0]);
  const teamId = asString(firstTeam.id);
  if (!teamId) {
    const error = new Error('当前账号尚未配置可管理的生产班组') as Error & {
      status?: number;
      code?: string;
    };
    error.status = 409;
    error.code = 'DAILY_PLAN_TEAM_REQUIRED';
    throw error;
  }
  return teamId;
}
