type WipAccessSubject = {
  laborRole: string;
  dailyPlanningRoles: readonly string[];
  access: {
    effectiveGrants: readonly { profile: string }[];
  };
};

const WIP_MANAGER_PROFILES = new Set([
  'ADMIN_GLOBAL',
  'WORKSHOP_SUPERVISOR',
  'WORKSHOP_TEAM_LEADER',
  'PLANNING_COLLABORATOR',
]);

/**
 * Moving or rescheduling WIP changes weekly planned labor. Reporting access is
 * deliberately insufficient: only admin, planning, supervisor and team-lead
 * identities may make that planning decision.
 */
export function canManageWipWarehouse(subject: WipAccessSubject): boolean {
  if (subject.laborRole === 'ADMIN' || subject.laborRole === 'TEAM_LEAD') return true;
  if (subject.dailyPlanningRoles.some(role => (
    role === 'WORKSHOP_SUPERVISOR' || role === 'TEAM_LEADER'
  ))) return true;
  return subject.access.effectiveGrants.some(grant => WIP_MANAGER_PROFILES.has(grant.profile));
}
