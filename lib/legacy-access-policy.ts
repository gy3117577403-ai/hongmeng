import {
  DEPARTMENT_CODES,
  type AccessGrant,
  type DepartmentCode,
} from '@/lib/department-access';

export type LegacyAccessAccount = {
  laborRole: 'ADMIN' | 'TEAM_LEAD' | 'EMPLOYEE';
  employeeId: string | null;
  employee: {
    id: string;
    departmentRef: { code: string } | null;
  } | null;
};

function departmentCode(value?: string | null): DepartmentCode | null {
  return DEPARTMENT_CODES.includes(value as DepartmentCode) ? value as DepartmentCode : null;
}

/**
 * Fail-closed compatibility for accounts created before explicit access grants.
 *
 * A legacy TEAM_LEAD flag is not an authorization source. In particular, an
 * employee's mutable HR team field must never manufacture a team-leader scope.
 * Legacy production accounts keep only their own QR field-report capability
 * until an administrator creates an explicit workshop/team grant.
 */
export function legacyFallbackGrants(account: LegacyAccessAccount): AccessGrant[] {
  if (account.laborRole === 'ADMIN') {
    return [{
      profile: 'ADMIN_GLOBAL',
      grantType: 'PRIMARY',
      scopeKey: 'GLOBAL',
      isActive: true,
    }];
  }

  const code = departmentCode(account.employee?.departmentRef?.code);
  if (account.employeeId && code === 'PRODUCTION') {
    return [{
      profile: 'FIELD_REPORTER',
      grantType: 'PRIMARY',
      departmentCode: code,
      scopeKey: `EMPLOYEE:${account.employeeId}`,
      isActive: true,
    }];
  }

  // Legacy non-production accounts receive self-service only until an
  // administrator explicitly confirms their department grant.
  return [{
    profile: 'FINANCE_ACCOUNT_ONLY',
    grantType: 'PRIMARY',
    departmentCode: code,
    scopeKey: account.employeeId ? `EMPLOYEE:${account.employeeId}` : 'SELF',
    isActive: true,
  }];
}
