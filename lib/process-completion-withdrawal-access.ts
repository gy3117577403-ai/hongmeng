import { DailyProcessTaskStatus, Prisma } from '@prisma/client';
import type { AccessContext } from '@/lib/department-access';
import {
  assertProductionScopeWrite,
  productionTeamScopeWhere,
  resolveProductionEntityScope,
  type ProductionEntityScope,
} from '@/lib/production-access-scope';

type WithdrawalScopeSubject = {
  laborRole: string;
  access: Pick<AccessContext, 'capabilities' | 'productionScope' | 'scopeHints'>;
  dailyPlanningRoles?: readonly string[];
  dailyPlanningTeamIds?: readonly string[];
};

function teamKeyFromScopeHint(hint: AccessContext['scopeHints'][number]): string | null {
  if (hint.module !== 'PRODUCTION') return null;
  const scopeKey = String(hint.scopeKey || '').trim();
  if (!scopeKey.toUpperCase().startsWith('TEAM:')) return null;
  return String(hint.teamId || scopeKey.slice(scopeKey.indexOf(':') + 1)).trim() || null;
}

function uniqueTeamKeys(values: readonly (string | null | undefined)[]): string[] {
  const keys = new Map<string, string>();
  for (const value of values) {
    const key = String(value || '').trim();
    if (!key) continue;
    const normalized = key.toLocaleLowerCase('zh-CN');
    if (!keys.has(normalized)) keys.set(normalized, key);
  }
  return [...keys.values()];
}

/**
 * Withdrawal approval changes historical production ledgers. Keep the broad
 * workshop workbench readable, while narrowing a team leader's approval queue
 * and mutation target to explicitly assigned teams.
 */
export function resolveProcessCompletionWithdrawalScope(
  subject: WithdrawalScopeSubject,
): ProductionEntityScope {
  const base = resolveProductionEntityScope({
    access: subject.access,
    dailyPlanningTeamIds: subject.dailyPlanningTeamIds,
  });
  assertProductionScopeWrite(base);

  const roles = new Set(subject.dailyPlanningRoles || []);
  const teamKeys = uniqueTeamKeys([
    ...(subject.dailyPlanningTeamIds || []),
    ...subject.access.scopeHints.map(teamKeyFromScopeHint),
  ]);
  const isGlobalActor = subject.laborRole === 'ADMIN'
    || roles.has('WORKSHOP_SUPERVISOR')
    || base.level === 'GLOBAL';
  if (!isGlobalActor && teamKeys.length) {
    return { ...base, level: 'TEAM', teamKeys };
  }
  return base;
}

export function processCompletionWithdrawalWorkOrderWhere(
  scope: ProductionEntityScope,
): Prisma.WorkOrderWhereInput {
  const teamWhere = productionTeamScopeWhere(scope) as Prisma.ProductionTeamWhereInput | null;
  if (!teamWhere) return {};
  return {
    dailyProcessTasks: {
      some: {
        status: { not: DailyProcessTaskStatus.CANCELLED },
        plan: { team: teamWhere },
      },
    },
  };
}
