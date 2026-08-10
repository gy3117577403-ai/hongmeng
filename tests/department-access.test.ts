import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACCESS_GRANT_TYPES,
  ACCESS_MODULES,
  ACCESS_PROFILE_CODES,
  BUSINESS_MODULES,
  DEPARTMENT_CODES,
  DEPARTMENT_OPERATION_ACTIONS,
  MODULE_ACTION_MATRIX,
  allowedActions,
  effectiveAccessGrants,
  hasCapability,
  isGrantEffective,
  resolveAccessContext,
  scopeHintsFor,
  visibleModules,
  type AccessGrant,
  type AccessProfileCode,
} from '@/lib/department-access';

const NOW = '2026-08-10T08:00:00.000Z';

function grant(
  profile: AccessProfileCode,
  overrides: Partial<AccessGrant> = {},
): AccessGrant {
  const defaultScopeKey = overrides.departmentCode
    ? `DEPARTMENT:${overrides.departmentCode}`
    : 'GLOBAL';
  return {
    id: `${profile.toLowerCase()}-grant`,
    profile,
    grantType: 'PRIMARY',
    scopeKey: defaultScopeKey,
    isActive: true,
    ...overrides,
  };
}

test('stable department, profile and grant-type codes match the persistence contract', () => {
  assert.deepEqual(DEPARTMENT_CODES, [
    'PRODUCTION',
    'BUSINESS',
    'PROCUREMENT',
    'WAREHOUSE',
    'ENGINEERING',
    'QUALITY',
    'GM_OFFICE',
    'FINANCE',
    'PROCESS',
    'PLANNING',
    'HR',
  ]);
  assert.deepEqual(ACCESS_PROFILE_CODES, [
    'ADMIN_GLOBAL',
    'DEPARTMENT_FULL',
    'FIELD_REPORTER',
    'GM_OFFICE_READER_APPROVER',
    'FINANCE_ACCOUNT_ONLY',
    'WORKSHOP_SUPERVISOR',
    'WORKSHOP_TEAM_LEADER',
  ]);
  assert.deepEqual(ACCESS_GRANT_TYPES, ['PRIMARY', 'CONCURRENT', 'ACTING']);
});

test('department module matrix never includes permanent deletion', () => {
  for (const module of BUSINESS_MODULES) {
    assert.equal(
      (MODULE_ACTION_MATRIX[module] as readonly string[]).includes('PERMANENT_DELETE'),
      false,
    );
  }
});

test('department full grants own business operations and common access only', () => {
  const context = resolveAccessContext([
    grant('DEPARTMENT_FULL', { departmentCode: 'BUSINESS' }),
  ], { now: NOW });

  assert.equal(hasCapability(context, 'BASIC_SUMMARY', 'READ'), true);
  assert.equal(hasCapability(context, 'ACCOUNT_SELF', 'UPDATE'), true);
  assert.equal(hasCapability(context, 'NOTIFICATIONS', 'READ'), true);

  for (const action of DEPARTMENT_OPERATION_ACTIONS) {
    assert.equal(hasCapability(context, 'BUSINESS', action), true);
  }

  assert.equal(hasCapability(context, 'BUSINESS', 'PERMANENT_DELETE'), false);
  assert.equal(hasCapability(context, 'QUALITY', 'READ'), false);
  assert.equal(hasCapability(context, 'ACCOUNT_ADMIN', 'MANAGE'), false);
  assert.equal(hasCapability(context, 'SYSTEM_CONFIGURATION', 'UPDATE'), false);
  assert.deepEqual(visibleModules(context), [
    'BASIC_SUMMARY',
    'ACCOUNT_SELF',
    'NOTIFICATIONS',
    'BUSINESS',
  ]);
  assert.deepEqual(allowedActions(context, 'BUSINESS'), DEPARTMENT_OPERATION_ACTIONS);
});

test('primary and concurrent department grants combine without broadening each module', () => {
  const context = resolveAccessContext([
    grant('DEPARTMENT_FULL', {
      id: 'primary-business',
      grantType: 'PRIMARY',
      departmentCode: 'BUSINESS',
    }),
    grant('DEPARTMENT_FULL', {
      id: 'concurrent-quality',
      grantType: 'CONCURRENT',
      departmentCode: 'QUALITY',
    }),
  ], { now: NOW });

  assert.equal(context.effectiveGrants.length, 2);
  assert.equal(hasCapability(context, 'BUSINESS', 'EXECUTE_WORKFLOW'), true);
  assert.equal(hasCapability(context, 'QUALITY', 'EXECUTE_WORKFLOW'), true);
  assert.equal(hasCapability(context, 'WAREHOUSE', 'READ'), false);
  assert.equal(hasCapability(context, 'QUALITY', 'PERMANENT_DELETE'), false);
  assert.equal(context.capabilities.filter(item => item === 'BASIC_SUMMARY:READ').length, 1);

  const qualityScope = scopeHintsFor(context, 'QUALITY');
  assert.equal(qualityScope.length, 1);
  assert.equal(qualityScope[0]?.level, 'DEPARTMENT');
  assert.equal(qualityScope[0]?.departmentCode, 'QUALITY');
  assert.equal(qualityScope[0]?.grantType, 'CONCURRENT');
});

test('acting grants use a half-open validity window and expired or disabled grants are filtered', () => {
  const activeActing = grant('DEPARTMENT_FULL', {
    id: 'acting-warehouse',
    grantType: 'ACTING',
    departmentCode: 'WAREHOUSE',
    effectiveFrom: '2026-08-10T00:00:00.000Z',
    effectiveTo: '2026-08-11T00:00:00.000Z',
  });
  const expiredActing = grant('DEPARTMENT_FULL', {
    id: 'expired-procurement',
    grantType: 'ACTING',
    departmentCode: 'PROCUREMENT',
    effectiveFrom: '2026-08-09T00:00:00.000Z',
    effectiveTo: NOW,
  });
  const futureConcurrent = grant('DEPARTMENT_FULL', {
    id: 'future-process',
    grantType: 'CONCURRENT',
    departmentCode: 'PROCESS',
    effectiveFrom: '2026-08-12T00:00:00.000Z',
  });
  const disabledPrimary = grant('DEPARTMENT_FULL', {
    id: 'disabled-engineering',
    departmentCode: 'ENGINEERING',
    isActive: false,
  });

  assert.equal(isGrantEffective(activeActing, NOW), true);
  assert.equal(isGrantEffective(expiredActing, NOW), false);
  assert.equal(isGrantEffective(futureConcurrent, NOW), false);
  assert.equal(isGrantEffective(disabledPrimary, NOW), false);
  assert.deepEqual(
    effectiveAccessGrants(
      [activeActing, expiredActing, futureConcurrent, disabledPrimary],
      NOW,
    ).map(item => item.id),
    ['acting-warehouse'],
  );

  const context = resolveAccessContext(
    [activeActing, expiredActing, futureConcurrent, disabledPrimary],
    { now: NOW },
  );
  assert.equal(hasCapability(context, 'WAREHOUSE', 'UPDATE'), true);
  assert.equal(hasCapability(context, 'PROCUREMENT', 'READ'), false);
  assert.equal(hasCapability(context, 'PROCESS', 'READ'), false);
  assert.equal(hasCapability(context, 'ENGINEERING', 'READ'), false);
});

test('finance account-only grant is isolated from summaries and business modules', () => {
  const context = resolveAccessContext([
    grant('FINANCE_ACCOUNT_ONLY', { departmentCode: 'FINANCE' }),
  ], { now: NOW });

  assert.deepEqual(visibleModules(context), ['ACCOUNT_SELF', 'NOTIFICATIONS']);
  assert.deepEqual(allowedActions(context, 'ACCOUNT_SELF'), ['READ', 'UPDATE']);
  assert.deepEqual(allowedActions(context, 'NOTIFICATIONS'), ['READ', 'UPDATE']);
  assert.equal(hasCapability(context, 'BASIC_SUMMARY', 'READ'), false);
  for (const module of BUSINESS_MODULES) {
    assert.equal(hasCapability(context, module, 'READ'), false);
  }
  assert.equal(hasCapability(context, 'MAJOR_APPROVAL', 'APPROVE'), false);
  assert.equal(hasCapability(context, 'ACCOUNT_ADMIN', 'READ'), false);
});

test('finance and GM cannot accidentally use DEPARTMENT_FULL special-department grants', () => {
  const context = resolveAccessContext([
    grant('DEPARTMENT_FULL', { departmentCode: 'FINANCE' }),
    grant('DEPARTMENT_FULL', {
      id: 'invalid-gm-full',
      departmentCode: 'GM_OFFICE',
    }),
  ], { now: NOW });

  assert.deepEqual(context.capabilities, []);
  assert.deepEqual(context.modules, []);
});

test('GM is globally read-only on business modules and can decide major approvals', () => {
  const context = resolveAccessContext([
    grant('GM_OFFICE_READER_APPROVER', {
      departmentCode: 'GM_OFFICE',
      scopeKey: 'GLOBAL',
    }),
  ], { now: NOW });

  assert.equal(hasCapability(context, 'BASIC_SUMMARY', 'READ'), true);
  for (const module of BUSINESS_MODULES) {
    assert.equal(hasCapability(context, module, 'READ'), true);
    assert.equal(hasCapability(context, module, 'CREATE'), false);
    assert.equal(hasCapability(context, module, 'UPDATE'), false);
    assert.equal(hasCapability(context, module, 'DELETE'), false);
    assert.equal(hasCapability(context, module, 'EXECUTE_WORKFLOW'), false);
  }
  assert.equal(hasCapability(context, 'MAJOR_APPROVAL', 'READ'), true);
  assert.equal(hasCapability(context, 'MAJOR_APPROVAL', 'APPROVE'), true);
  assert.equal(hasCapability(context, 'ACCOUNT_ADMIN', 'MANAGE'), false);
  assert.equal(hasCapability(context, 'SYSTEM_CONFIGURATION', 'UPDATE'), false);
  assert.equal(context.productionScope, 'GLOBAL');

  const productionScope = scopeHintsFor(context, 'PRODUCTION');
  assert.equal(productionScope.length, 1);
  assert.equal(productionScope[0]?.level, 'GLOBAL');
  assert.equal(productionScope[0]?.readOnly, true);
});

test('field reporter can only use the field-report module', () => {
  const context = resolveAccessContext([
    grant('FIELD_REPORTER', {
      departmentCode: 'PRODUCTION',
      scopeKey: 'EMPLOYEE:employee-1',
    }),
  ], { now: NOW });

  assert.deepEqual(visibleModules(context), ['FIELD_REPORT']);
  assert.deepEqual(allowedActions(context, 'FIELD_REPORT'), [
    'READ',
    'CREATE',
    'EXECUTE_WORKFLOW',
  ]);
  assert.equal(hasCapability(context, 'ACCOUNT_SELF', 'READ'), false);
  assert.equal(hasCapability(context, 'NOTIFICATIONS', 'READ'), false);
  assert.equal(hasCapability(context, 'BASIC_SUMMARY', 'READ'), false);
  assert.equal(hasCapability(context, 'PRODUCTION', 'READ'), false);
});

test('workshop supervisor gets production operations for the whole workshop scope', () => {
  const context = resolveAccessContext([
    grant('WORKSHOP_SUPERVISOR', {
      departmentCode: 'PRODUCTION',
      scopeKey: 'WORKSHOP:workshop-a',
    }),
  ], { now: NOW });

  for (const action of DEPARTMENT_OPERATION_ACTIONS) {
    assert.equal(hasCapability(context, 'PRODUCTION', action), true);
  }
  assert.equal(hasCapability(context, 'PRODUCTION', 'PERMANENT_DELETE'), false);
  assert.equal(context.productionScope, 'WORKSHOP');
  assert.deepEqual(scopeHintsFor(context, 'PRODUCTION'), [{
    module: 'PRODUCTION',
    level: 'WORKSHOP',
    readOnly: false,
    grantType: 'PRIMARY',
    scopeKey: 'WORKSHOP:workshop-a',
    sourceGrantId: 'workshop_supervisor-grant',
    departmentCode: 'PRODUCTION',
    workshopId: 'workshop-a',
  }]);
});

test('workshop team leader gets the same actions constrained to the assigned team', () => {
  const context = resolveAccessContext([
    grant('WORKSHOP_TEAM_LEADER', {
      departmentCode: 'PRODUCTION',
      scopeKey: 'TEAM:team-2',
    }),
  ], { now: NOW });

  assert.equal(hasCapability(context, 'PRODUCTION', 'EXECUTE_WORKFLOW'), true);
  assert.equal(hasCapability(context, 'PRODUCTION', 'PERMANENT_DELETE'), false);
  assert.equal(context.productionScope, 'TEAM');

  const scope = scopeHintsFor(context, 'PRODUCTION')[0];
  assert.equal(scope?.level, 'TEAM');
  assert.equal(scope?.teamId, 'team-2');
});

test('multiple production grants preserve scope details and resolve to the broadest scope hint', () => {
  const context = resolveAccessContext([
    grant('WORKSHOP_TEAM_LEADER', {
      id: 'team-role',
      departmentCode: 'PRODUCTION',
      scopeKey: 'TEAM:team-2',
    }),
    grant('WORKSHOP_SUPERVISOR', {
      id: 'acting-supervisor',
      grantType: 'ACTING',
      departmentCode: 'PRODUCTION',
      scopeKey: 'WORKSHOP:workshop-a',
      effectiveTo: '2026-08-11T00:00:00.000Z',
    }),
  ], { now: NOW });

  assert.equal(context.productionScope, 'WORKSHOP');
  assert.deepEqual(
    scopeHintsFor(context, 'PRODUCTION').map(item => item.level),
    ['TEAM', 'WORKSHOP'],
  );
});

test('admin has every registered capability with global scope', () => {
  const context = resolveAccessContext([
    grant('ADMIN_GLOBAL'),
  ], { now: NOW });

  assert.deepEqual(visibleModules(context), ACCESS_MODULES);
  for (const module of ACCESS_MODULES) {
    const expectedActions = BUSINESS_MODULES.includes(module as typeof BUSINESS_MODULES[number])
      ? [...MODULE_ACTION_MATRIX[module], 'PERMANENT_DELETE']
      : MODULE_ACTION_MATRIX[module];
    assert.deepEqual(allowedActions(context, module), expectedActions);
  }
  for (const module of BUSINESS_MODULES) {
    assert.equal(hasCapability(context, module, 'PERMANENT_DELETE'), true);
  }
  assert.equal(hasCapability(context, 'ACCOUNT_ADMIN', 'MANAGE'), true);
  assert.equal(hasCapability(context, 'SYSTEM_CONFIGURATION', 'MANAGE'), true);
  assert.equal(context.productionScope, 'GLOBAL');
  assert.equal(scopeHintsFor(context, 'PRODUCTION')[0]?.level, 'GLOBAL');
});

test('disabled account resolves no access even when an admin grant is active', () => {
  const context = resolveAccessContext([
    grant('ADMIN_GLOBAL'),
  ], { accountActive: false, now: NOW });

  assert.equal(context.accountActive, false);
  assert.deepEqual(context.effectiveGrants, []);
  assert.deepEqual(context.capabilities, []);
  assert.deepEqual(context.modules, []);
  assert.deepEqual(context.scopeHints, []);
  assert.equal(context.productionScope, 'NONE');
});
