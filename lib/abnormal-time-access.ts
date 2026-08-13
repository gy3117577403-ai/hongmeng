import { hasCapability, type AccessContext } from '@/lib/department-access';
import { prisma } from '@/lib/prisma';
import { productionPlanningDateBoundary } from '@/lib/production-planning-date';
import { productionEmployeeWhere } from '@/lib/production-workforce';

export type AbnormalTimeAccessActor = {
  laborRole: 'ADMIN' | 'TEAM_LEAD' | 'EMPLOYEE';
  employee: { id: string; isActive: boolean; team: string | null } | null;
  access: Pick<AccessContext, 'capabilities' | 'productionScope' | 'scopeHints'>;
};

function productionTeamKeys(actor: AbnormalTimeAccessActor): string[] {
  return [...new Set(actor.access.scopeHints.flatMap(hint => {
    if (hint.module !== 'PRODUCTION' || hint.level !== 'TEAM') return [];
    const key = String(hint.teamId || hint.scopeKey.replace(/^TEAM:/i, '') || '').trim();
    return key ? [key] : [];
  }))];
}

export function canReviewAbnormalTime(actor: AbnormalTimeAccessActor): boolean {
  if (
    hasCapability(actor.access, 'QUALITY', 'UPDATE')
    || hasCapability(actor.access, 'QUALITY', 'EXECUTE_WORKFLOW')
  ) return true;
  return (
    actor.access.productionScope === 'WORKSHOP'
    || actor.access.productionScope === 'GLOBAL'
  ) && (
    hasCapability(actor.access, 'PRODUCTION', 'UPDATE')
    || hasCapability(actor.access, 'PRODUCTION', 'EXECUTE_WORKFLOW')
  );
}

/**
 * null means workshop/global visibility; an array means the event must be
 * filtered through its affected employees. Field-only accounts never reach
 * this API namespace and therefore cannot use this helper to widen access.
 */
export async function abnormalTimeScopedEmployeeIds(
  actor: AbnormalTimeAccessActor,
): Promise<string[] | null> {
  if (
    hasCapability(actor.access, 'HR', 'READ')
    || hasCapability(actor.access, 'QUALITY', 'READ')
    || actor.access.productionScope === 'WORKSHOP'
    || actor.access.productionScope === 'GLOBAL'
  ) return null;

  if (actor.access.productionScope === 'TEAM') {
    const keys = productionTeamKeys(actor);
    if (!keys.length) return [];
    const membershipDate = productionPlanningDateBoundary();
    const teams = await prisma.productionTeam.findMany({
      where: {
        isActive: true,
        OR: [
          { id: { in: keys } },
          { code: { in: keys } },
          { name: { in: keys } },
          { legacyTeamName: { in: keys } },
        ],
      },
      select: { id: true, code: true, name: true, legacyTeamName: true },
    });
    const teamIds = teams.map(team => team.id);
    const legacyNames = [...new Set([
      ...keys,
      ...teams.flatMap(team => [team.code, team.name, team.legacyTeamName]).filter((value): value is string => Boolean(value)),
    ])];
    return (await prisma.employee.findMany({
      where: {
        ...productionEmployeeWhere(),
        OR: [
          { team: { in: legacyNames } },
          ...(teamIds.length
            ? [{ productionPlanningMemberships: { some: {
              teamId: { in: teamIds },
              isActive: true,
              effectiveFrom: { lte: membershipDate },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: membershipDate } }],
            } } }]
            : []),
        ],
      },
      select: { id: true },
    })).map(employee => employee.id);
  }

  if (actor.employee?.isActive) return [actor.employee.id];
  return [];
}

export async function canReviewAbnormalTimeEvent(
  actor: AbnormalTimeAccessActor,
  allocationEmployeeIds: readonly string[],
): Promise<boolean> {
  if (!canReviewAbnormalTime(actor)) return false;
  const scopedIds = await abnormalTimeScopedEmployeeIds(actor);
  if (scopedIds === null) return true;
  const allowed = new Set(scopedIds);
  return allocationEmployeeIds.length > 0 && allocationEmployeeIds.every(id => allowed.has(id));
}

export function abnormalTimeScopeLabel(actor: AbnormalTimeAccessActor): string {
  if (actor.access.productionScope === 'TEAM') return '本人班组';
  if (actor.access.productionScope === 'WORKSHOP') return '生产车间';
  if (actor.access.productionScope === 'GLOBAL') return '全公司';
  if (hasCapability(actor.access, 'HR', 'READ') || hasCapability(actor.access, 'QUALITY', 'READ')) return '全部记录';
  return '本人记录';
}
