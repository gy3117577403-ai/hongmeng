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
    'PROCESS_SPECIALIST',
    'DRAWING_LIBRARY_READER',
    'DRAWING_LIBRARY_EDITOR',
    'REPORT_PEOPLE_READER',
    'QUALITY_REVIEWER',
    'FIELD_REPORTER',
    'GM_OFFICE_READER_APPROVER',
    'FINANCE_ACCOUNT_ONLY',
    'WORKSHOP_SUPERVISOR',
    'WORKSHOP_TEAM_LEADER',
    'PLANNING_COLLABORATOR',
    'PRODUCTION_COLLABORATOR',
    'MATERIAL_FOLLOW_UP_OPERATOR',
    'TRAINING_COLLABORATOR',
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

test('functional roles combine drawing, people-report and quality access without destructive powers', () => {
  const context = resolveAccessContext([
    grant('DRAWING_LIBRARY_EDITOR', {
      id: 'drawing-editor',
      grantType: 'CONCURRENT',
      departmentCode: 'ENGINEERING',
      scopeKey: 'GLOBAL:DRAWING_LIBRARY',
    }),
    grant('REPORT_PEOPLE_READER', {
      id: 'people-reader',
      grantType: 'CONCURRENT',
      departmentCode: 'HR',
      scopeKey: 'GLOBAL:REPORT_PEOPLE',
    }),
    grant('QUALITY_REVIEWER', {
      id: 'quality-reviewer',
      grantType: 'CONCURRENT',
      departmentCode: 'QUALITY',
      scopeKey: 'GLOBAL:QUALITY_REVIEW',
    }),
  ], { now: NOW });

  assert.deepEqual(allowedActions(context, 'DRAWING_LIBRARY'), ['READ', 'CREATE', 'UPDATE']);
  assert.equal(hasCapability(context, 'DRAWING_LIBRARY', 'DELETE'), false);
  assert.deepEqual(allowedActions(context, 'REPORT_CENTER'), ['READ']);
  assert.deepEqual(allowedActions(context, 'QUALITY'), ['READ', 'CREATE', 'UPDATE', 'EXECUTE_WORKFLOW']);
  assert.equal(hasCapability(context, 'QUALITY', 'DELETE'), false);
  assert.equal(scopeHintsFor(context, 'REPORT_CENTER')[0]?.level, 'GLOBAL');
  assert.equal(scopeHintsFor(context, 'REPORT_CENTER')[0]?.readOnly, true);
});

test('process specialist owns process and terminal tooling while production and drawings stay read-only', () => {
  const context = resolveAccessContext([
    grant('PROCESS_SPECIALIST', {
      departmentCode: 'PROCESS',
      scopeKey: 'DEPARTMENT:PROCESS',
    }),
  ], { now: NOW });

  for (const action of DEPARTMENT_OPERATION_ACTIONS) {
    assert.equal(hasCapability(context, 'PROCESS', action), true);
  }
  for (const module of ['ISSUE_MANAGEMENT', 'CHANGE_MANAGEMENT'] as const) {
    assert.deepEqual(allowedActions(context, module), ['READ', 'CREATE', 'UPDATE', 'EXECUTE_WORKFLOW']);
    assert.equal(scopeHintsFor(context, module)[0]?.level, 'DEPARTMENT');
    assert.equal(scopeHintsFor(context, module)[0]?.readOnly, false);
  }
  assert.deepEqual(allowedActions(context, 'DRAWING_LIBRARY'), ['READ']);
  assert.deepEqual(allowedActions(context, 'TERMINAL_TOOLING'), ['READ', 'CREATE', 'UPDATE', 'EXECUTE_WORKFLOW']);
  assert.deepEqual(allowedActions(context, 'PRODUCTION'), ['READ']);
  assert.equal(scopeHintsFor(context, 'DRAWING_LIBRARY')[0]?.level, 'GLOBAL');
  assert.equal(scopeHintsFor(context, 'DRAWING_LIBRARY')[0]?.readOnly, true);
  assert.equal(scopeHintsFor(context, 'TERMINAL_TOOLING')[0]?.level, 'GLOBAL');
  assert.equal(scopeHintsFor(context, 'TERMINAL_TOOLING')[0]?.readOnly, false);
  assert.equal(scopeHintsFor(context, 'PRODUCTION')[0]?.level, 'WORKSHOP');
  assert.equal(scopeHintsFor(context, 'PRODUCTION')[0]?.readOnly, true);
  assert.equal(context.productionScope, 'WORKSHOP');
  assert.equal(hasCapability(context, 'QUALITY', 'READ'), false);
  assert.equal(hasCapability(context, 'ENGINEERING', 'READ'), false);
  assert.equal(hasCapability(context, 'PLANNING', 'READ'), false);
  assert.equal(hasCapability(context, 'PRODUCTION', 'UPDATE'), false);
  assert.equal(hasCapability(context, 'DRAWING_LIBRARY', 'UPDATE'), false);
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
  assert.deepEqual(allowedActions(context, 'TERMINAL_TOOLING'), ['READ']);
  assert.deepEqual(allowedActions(context, 'DRAWING_LIBRARY'), ['READ']);
  assert.deepEqual(allowedActions(context, 'ASSEMBLY_MANUALS'), ['READ']);
  assert.deepEqual(allowedActions(context, 'PRODUCT_TIME'), ['READ']);
  assert.deepEqual(allowedActions(context, 'ATTENDANCE'), DEPARTMENT_OPERATION_ACTIONS);
  assert.deepEqual(allowedActions(context, 'ISSUE_MANAGEMENT'), ['READ', 'CREATE', 'UPDATE', 'EXECUTE_WORKFLOW']);
  assert.equal(scopeHintsFor(context, 'TERMINAL_TOOLING')[0]?.level, 'GLOBAL');
  assert.equal(scopeHintsFor(context, 'TERMINAL_TOOLING')[0]?.readOnly, true);
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
  assert.equal(scopeHintsFor(context, 'ATTENDANCE')[0]?.level, 'WORKSHOP');
  assert.equal(scopeHintsFor(context, 'ISSUE_MANAGEMENT')[0]?.level, 'GLOBAL');
  assert.equal(scopeHintsFor(context, 'DRAWING_LIBRARY')[0]?.readOnly, true);
});

test('workshop team leader gets full actions in every opened module over the shared workshop data', () => {
  const context = resolveAccessContext([
    grant('WORKSHOP_TEAM_LEADER', {
      departmentCode: 'PRODUCTION',
      scopeKey: 'TEAM:team-2',
    }),
  ], { now: NOW });

  assert.equal(hasCapability(context, 'PRODUCTION', 'EXECUTE_WORKFLOW'), true);
  assert.equal(hasCapability(context, 'PRODUCTION', 'PERMANENT_DELETE'), false);
  assert.equal(context.productionScope, 'WORKSHOP');
  for (const module of ['PRODUCTION', 'TERMINAL_TOOLING', 'DRAWING_LIBRARY', 'ASSEMBLY_MANUALS', 'PRODUCT_TIME', 'ATTENDANCE'] as const) {
    assert.deepEqual(allowedActions(context, module), DEPARTMENT_OPERATION_ACTIONS, module);
    assert.equal(hasCapability(context, module, 'PERMANENT_DELETE'), false, module);
  }
  assert.deepEqual(allowedActions(context, 'ISSUE_MANAGEMENT'), ['READ', 'CREATE', 'UPDATE', 'EXECUTE_WORKFLOW']);
  assert.equal(hasCapability(context, 'ISSUE_MANAGEMENT', 'DELETE'), false);
  assert.equal(scopeHintsFor(context, 'ISSUE_MANAGEMENT')[0]?.level, 'GLOBAL');

  const scope = scopeHintsFor(context, 'PRODUCTION')[0];
  assert.equal(scope?.level, 'WORKSHOP');
  assert.equal(scope?.readOnly, false);
  assert.equal(scope?.teamId, 'team-2');
  const attendanceScope = scopeHintsFor(context, 'ATTENDANCE')[0];
  assert.equal(attendanceScope?.level, 'WORKSHOP');
  assert.equal(attendanceScope?.teamId, 'team-2');
  for (const module of ['TERMINAL_TOOLING', 'DRAWING_LIBRARY', 'ASSEMBLY_MANUALS', 'PRODUCT_TIME'] as const) {
    assert.equal(scopeHintsFor(context, module)[0]?.level, 'GLOBAL');
    assert.equal(scopeHintsFor(context, module)[0]?.readOnly, false);
  }
});

test('cross-functional collaborator profiles expose shared data with deliberately bounded writes', () => {
  const planning = resolveAccessContext([grant('PLANNING_COLLABORATOR', {
    grantType: 'CONCURRENT', departmentCode: 'PLANNING', scopeKey: 'GLOBAL:PLANNING_COLLABORATION',
  })], { now: NOW });
  assert.deepEqual(allowedActions(planning, 'PLANNING'), ['READ', 'CREATE', 'UPDATE']);
  assert.equal(scopeHintsFor(planning, 'PLANNING')[0]?.level, 'GLOBAL');
  assert.equal(hasCapability(planning, 'PLANNING', 'DELETE'), false);
  assert.equal(hasCapability(planning, 'PLANNING', 'EXECUTE_WORKFLOW'), false);

  const production = resolveAccessContext([grant('PRODUCTION_COLLABORATOR', {
    grantType: 'CONCURRENT', departmentCode: 'PRODUCTION', scopeKey: 'WORKSHOP:PRODUCTION_COLLABORATION',
  })], { now: NOW });
  assert.deepEqual(allowedActions(production, 'PRODUCTION'), ['READ']);
  assert.equal(production.productionScope, 'WORKSHOP');
  assert.equal(scopeHintsFor(production, 'PRODUCTION')[0]?.readOnly, true);

  const material = resolveAccessContext([grant('MATERIAL_FOLLOW_UP_OPERATOR', {
    grantType: 'CONCURRENT', departmentCode: 'PROCUREMENT', scopeKey: 'GLOBAL:MATERIAL_FOLLOW_UP',
  })], { now: NOW });
  assert.deepEqual(allowedActions(material, 'PROCUREMENT'), ['READ', 'UPDATE', 'EXECUTE_WORKFLOW']);
  assert.equal(scopeHintsFor(material, 'PROCUREMENT')[0]?.level, 'GLOBAL');
  assert.equal(hasCapability(material, 'PROCUREMENT', 'CREATE'), false);
  assert.equal(hasCapability(material, 'PROCUREMENT', 'DELETE'), false);
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
    ['WORKSHOP', 'WORKSHOP'],
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

test('training collaborator operates the real training ledger without inheriting unrelated HR data', () => {
  const context = resolveAccessContext([
    grant('TRAINING_COLLABORATOR', {
      departmentCode: 'HR',
      grantType: 'CONCURRENT',
      scopeKey: 'GLOBAL:TRAINING',
    }),
  ], { now: NOW });

  assert.equal(hasCapability(context, 'TRAINING', 'READ'), true);
  assert.equal(hasCapability(context, 'TRAINING', 'CREATE'), true);
  assert.equal(hasCapability(context, 'TRAINING', 'UPDATE'), true);
  assert.equal(hasCapability(context, 'TRAINING', 'DELETE'), true);
  assert.equal(hasCapability(context, 'TRAINING', 'EXECUTE_WORKFLOW'), true);
  assert.equal(hasCapability(context, 'HR', 'READ'), false);
  assert.deepEqual(visibleModules(context).filter(module => ['HR', 'TRAINING'].includes(module)), ['TRAINING']);
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
