import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { resolveAccessContext } from '../lib/department-access';
import {
  processCompletionWithdrawalWorkOrderWhere,
  resolveProcessCompletionWithdrawalScope,
} from '../lib/process-completion-withdrawal-access';

test('withdrawal approval narrows team leaders to assigned teams', () => {
  const access = resolveAccessContext([{
    profile: 'WORKSHOP_TEAM_LEADER',
    grantType: 'PRIMARY',
    departmentCode: 'PRODUCTION',
    scopeKey: 'TEAM:装配一组',
  }]);
  const scope = resolveProcessCompletionWithdrawalScope({
    laborRole: 'TEAM_LEAD',
    access,
    dailyPlanningRoles: ['TEAM_LEADER'],
    dailyPlanningTeamIds: ['team-a'],
  });
  assert.equal(scope.level, 'TEAM');
  assert.deepEqual([...scope.teamKeys].sort(), ['team-a', '装配一组'].sort());
  assert.deepEqual(processCompletionWithdrawalWorkOrderWhere(scope), {
    dailyProcessTasks: {
      some: {
        status: { not: 'CANCELLED' },
        plan: {
          team: {
            OR: [
              { id: { in: scope.teamKeys } },
              { code: { in: scope.teamKeys } },
              { name: { in: scope.teamKeys } },
              { legacyTeamName: { in: scope.teamKeys } },
            ],
          },
        },
      },
    },
  });
});

test('withdrawal approval keeps supervisors and administrators workshop/global', () => {
  const supervisorAccess = resolveAccessContext([{
    profile: 'WORKSHOP_SUPERVISOR',
    grantType: 'PRIMARY',
    departmentCode: 'PRODUCTION',
    scopeKey: 'WORKSHOP:PRODUCTION',
  }]);
  const supervisor = resolveProcessCompletionWithdrawalScope({
    laborRole: 'TEAM_LEAD',
    access: supervisorAccess,
    dailyPlanningRoles: ['WORKSHOP_SUPERVISOR'],
    dailyPlanningTeamIds: ['team-a'],
  });
  assert.equal(supervisor.level, 'WORKSHOP');
  assert.deepEqual(processCompletionWithdrawalWorkOrderWhere(supervisor), {});

  const adminAccess = resolveAccessContext([{
    profile: 'ADMIN_GLOBAL',
    grantType: 'PRIMARY',
    scopeKey: 'GLOBAL',
  }]);
  const admin = resolveProcessCompletionWithdrawalScope({
    laborRole: 'ADMIN',
    access: adminAccess,
  });
  assert.equal(admin.level, 'GLOBAL');
  assert.deepEqual(processCompletionWithdrawalWorkOrderWhere(admin), {});
});

test('direct manager withdrawal enforces the same production scope as the approval queue', () => {
  const routeSource = readFileSync(resolve(
    import.meta.dirname,
    '../app/api/process-management/routes/[id]/completions/[completionId]/withdraw/route.ts',
  ), 'utf8');
  assert.match(routeSource, /resolveProcessCompletionWithdrawalScope\(user\)/);
  assert.match(routeSource, /workOrder:\s*processCompletionWithdrawalWorkOrderWhere\(scope\)/);
  assert.match(routeSource, /await assertWithdrawalTargetAllowed\(user, params\.id, params\.completionId\)/g);
  assert.match(routeSource, /PROCESS_COMPLETION_WITHDRAWAL_SCOPE_FORBIDDEN/);
});
