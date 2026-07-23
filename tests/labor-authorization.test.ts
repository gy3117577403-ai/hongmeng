import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorizeLaborClaim,
  authorizeLaborStandardResolution,
  authorizeLaborVoid,
  canViewLaborClaim,
  LaborAuthorizationError,
  laborAccessProfile,
  type LaborAuthorizationActor,
} from '../lib/labor-authorization';

function actor(
  laborRole: LaborAuthorizationActor['laborRole'],
  employee: LaborAuthorizationActor['employee'],
): LaborAuthorizationActor {
  return { id: `${laborRole}-actor`, isActive: true, laborRole, employee };
}

const teamAEmployee = { id: 'employee-a', isActive: true, team: 'A组' };
const teamAPeer = { id: 'employee-a-peer', isActive: true, team: 'A组' };
const teamBEmployee = { id: 'employee-b', isActive: true, team: 'B组' };

test('administrator can allocate, void, and resolve standards across teams', () => {
  const admin = actor('ADMIN', null);
  assert.doesNotThrow(() => authorizeLaborClaim(admin, teamBEmployee));
  assert.doesNotThrow(() => authorizeLaborVoid(admin, teamBEmployee));
  assert.doesNotThrow(() => authorizeLaborStandardResolution(admin));
  assert.equal(laborAccessProfile(admin).canResolveStandard, true);
});

test('team lead can allocate and void only inside the bound team', () => {
  const teamLead = actor('TEAM_LEAD', teamAEmployee);
  assert.doesNotThrow(() => authorizeLaborClaim(teamLead, teamAPeer));
  assert.doesNotThrow(() => authorizeLaborVoid(teamLead, teamAPeer));
  assert.throws(
    () => authorizeLaborClaim(teamLead, teamBEmployee),
    (error: unknown) => error instanceof LaborAuthorizationError
      && error.code === 'PROCESS_LABOR_TEAM_SCOPE_FORBIDDEN',
  );
  assert.throws(
    () => authorizeLaborVoid(teamLead, teamBEmployee),
    (error: unknown) => error instanceof LaborAuthorizationError
      && error.code === 'PROCESS_LABOR_TEAM_SCOPE_FORBIDDEN',
  );
  assert.throws(
    () => authorizeLaborStandardResolution(teamLead),
    (error: unknown) => error instanceof LaborAuthorizationError
      && error.code === 'PROCESS_LABOR_STANDARD_FORBIDDEN',
  );
});

test('employee can claim only for self and cannot void or resolve standards', () => {
  const employee = actor('EMPLOYEE', teamAEmployee);
  assert.doesNotThrow(() => authorizeLaborClaim(employee, teamAEmployee));
  assert.throws(
    () => authorizeLaborClaim(employee, teamAPeer),
    (error: unknown) => error instanceof LaborAuthorizationError
      && error.code === 'PROCESS_LABOR_SELF_CLAIM_ONLY',
  );
  assert.throws(
    () => authorizeLaborVoid(employee, teamAEmployee),
    (error: unknown) => error instanceof LaborAuthorizationError
      && error.code === 'PROCESS_LABOR_VOID_FORBIDDEN',
  );
  assert.throws(
    () => authorizeLaborStandardResolution(employee),
    (error: unknown) => error instanceof LaborAuthorizationError
      && error.code === 'PROCESS_LABOR_STANDARD_FORBIDDEN',
  );
});

test('unbound, teamless, inactive, and disabled targets are rejected', () => {
  assert.throws(
    () => authorizeLaborClaim(actor('EMPLOYEE', null), teamAEmployee),
    (error: unknown) => error instanceof LaborAuthorizationError
      && error.code === 'PROCESS_LABOR_ACTOR_NOT_CONFIGURED',
  );
  assert.throws(
    () => authorizeLaborClaim(
      actor('TEAM_LEAD', { id: 'lead', isActive: true, team: null }),
      teamAEmployee,
    ),
    (error: unknown) => error instanceof LaborAuthorizationError
      && error.code === 'PROCESS_LABOR_ACTOR_NOT_CONFIGURED',
  );
  assert.throws(
    () => authorizeLaborClaim(
      { ...actor('EMPLOYEE', teamAEmployee), isActive: false },
      teamAEmployee,
    ),
    (error: unknown) => error instanceof LaborAuthorizationError
      && error.code === 'PROCESS_LABOR_ACTOR_NOT_CONFIGURED',
  );
  assert.throws(
    () => authorizeLaborClaim(
      actor('ADMIN', null),
      { ...teamAEmployee, isActive: false },
    ),
    (error: unknown) => error instanceof LaborAuthorizationError
      && error.code === 'PROCESS_LABOR_TARGET_EMPLOYEE_INACTIVE',
  );
});

test('claim details are visible only inside the actor labor scope', () => {
  const adminAccess = laborAccessProfile(actor('ADMIN', null));
  const leadAccess = laborAccessProfile(actor('TEAM_LEAD', teamAEmployee));
  const employeeAccess = laborAccessProfile(actor('EMPLOYEE', teamAEmployee));
  assert.equal(canViewLaborClaim(adminAccess, teamBEmployee), true);
  assert.equal(canViewLaborClaim(leadAccess, teamAPeer), true);
  assert.equal(canViewLaborClaim(leadAccess, teamBEmployee), false);
  assert.equal(canViewLaborClaim(employeeAccess, teamAEmployee), true);
  assert.equal(canViewLaborClaim(employeeAccess, teamAPeer), false);
});
