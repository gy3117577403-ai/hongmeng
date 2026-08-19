import assert from 'node:assert/strict';
import test from 'node:test';
import { ACCESS_DATA_CONTRACTS } from '../lib/access-data-contracts';
import { canAccessApiRoute } from '../lib/api-route-access';
import {
  resolveAccessContext,
  type AccessContext,
  type AccessGrant,
  type AccessModuleCode,
  type CapabilityCode,
} from '../lib/department-access';

test('every registered module data contract is readable by its owning module', () => {
  for (const [module, contract] of Object.entries(ACCESS_DATA_CONTRACTS)) {
    if (!contract) continue;
    const moduleCode = module as AccessModuleCode;
    const access: Pick<AccessContext, 'capabilities' | 'productionScope'> = {
      capabilities: [`${moduleCode}:READ` as CapabilityCode],
      productionScope: moduleCode === 'PRODUCTION' ? 'WORKSHOP' : 'NONE',
    };
    for (const endpoint of contract.endpoints) {
      assert.equal(
        canAccessApiRoute(access, endpoint, 'GET'),
        true,
        `${moduleCode} must read ${endpoint}`,
      );
    }
  }
});

test('every module exposed by a real access profile can read its registered data contract', () => {
  const grants: AccessGrant[] = [
    { profile: 'ADMIN_GLOBAL', grantType: 'PRIMARY', scopeKey: 'GLOBAL' },
    { profile: 'FIELD_REPORTER', grantType: 'PRIMARY', departmentCode: 'PRODUCTION', scopeKey: 'EMPLOYEE:E-1' },
    { profile: 'FINANCE_ACCOUNT_ONLY', grantType: 'PRIMARY', departmentCode: 'FINANCE', scopeKey: 'EMPLOYEE:E-2' },
    { profile: 'GM_OFFICE_READER_APPROVER', grantType: 'PRIMARY', departmentCode: 'GM_OFFICE', scopeKey: 'GLOBAL' },
    { profile: 'DRAWING_LIBRARY_READER', grantType: 'CONCURRENT', departmentCode: 'QUALITY', scopeKey: 'GLOBAL' },
    { profile: 'DRAWING_LIBRARY_EDITOR', grantType: 'CONCURRENT', departmentCode: 'ENGINEERING', scopeKey: 'GLOBAL' },
    { profile: 'REPORT_PEOPLE_READER', grantType: 'CONCURRENT', departmentCode: 'HR', scopeKey: 'GLOBAL' },
    { profile: 'QUALITY_REVIEWER', grantType: 'PRIMARY', departmentCode: 'QUALITY', scopeKey: 'GLOBAL' },
    { profile: 'PROCESS_SPECIALIST', grantType: 'PRIMARY', departmentCode: 'PROCESS', scopeKey: 'DEPARTMENT:PROCESS' },
    { profile: 'WORKSHOP_SUPERVISOR', grantType: 'PRIMARY', departmentCode: 'PRODUCTION', scopeKey: 'WORKSHOP:MAIN' },
    { profile: 'WORKSHOP_TEAM_LEADER', grantType: 'PRIMARY', departmentCode: 'PRODUCTION', scopeKey: 'TEAM:A' },
    { profile: 'PLANNING_COLLABORATOR', grantType: 'CONCURRENT', departmentCode: 'PLANNING', scopeKey: 'GLOBAL:PLANNING_COLLABORATION' },
    { profile: 'PRODUCTION_COLLABORATOR', grantType: 'CONCURRENT', departmentCode: 'PRODUCTION', scopeKey: 'WORKSHOP:PRODUCTION_COLLABORATION' },
    { profile: 'MATERIAL_FOLLOW_UP_OPERATOR', grantType: 'CONCURRENT', departmentCode: 'PROCUREMENT', scopeKey: 'GLOBAL:MATERIAL_FOLLOW_UP' },
    ...(['BUSINESS', 'PROCUREMENT', 'WAREHOUSE', 'ENGINEERING', 'QUALITY', 'PROCESS', 'PLANNING', 'HR'] as const).map(
      departmentCode => ({
        profile: 'DEPARTMENT_FULL' as const,
        grantType: 'PRIMARY' as const,
        departmentCode,
        scopeKey: `DEPARTMENT:${departmentCode}`,
      }),
    ),
  ];

  for (const grant of grants) {
    const access = resolveAccessContext([grant], { now: new Date('2026-08-19T00:00:00.000Z') });
    for (const module of access.modules) {
      const contract = ACCESS_DATA_CONTRACTS[module];
      if (!contract) continue;
      for (const endpoint of contract.endpoints) {
        assert.equal(
          canAccessApiRoute(access, endpoint, 'GET'),
          true,
          `${grant.profile}/${grant.departmentCode || 'NONE'} exposes ${module} but cannot read ${endpoint}`,
        );
      }
    }
  }
});
