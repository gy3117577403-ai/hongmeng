import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AccountStatus,
  AccessGrantType,
  AccessProfileKey,
  type Prisma,
} from '@prisma/client';
import {
  departmentCodeFromLegacyText,
  disableLinkedEmployeeAccess,
  EmployeeDepartmentInputError,
  employeePermissionSyncPending,
  isEffectiveEmployeeGrant,
  resolveEmployeeDepartmentInput,
  serializeEmployeeAccessAdmin,
  type EmployeeAccessAdminRecord,
  type EmployeeDepartmentRecord,
} from '@/lib/employee-access-admin';

const NOW = new Date('2026-08-10T08:00:00.000Z');

const DEPARTMENTS = {
  BUSINESS: { id: 'department-business', code: 'BUSINESS', name: '业务部', isActive: true },
  QUALITY: { id: 'department-quality', code: 'QUALITY', name: '质量部', isActive: true },
  HR: { id: 'department-hr', code: 'HR', name: '人事部', isActive: true },
} as const satisfies Record<string, EmployeeDepartmentRecord>;

function accessGrant(overrides: Partial<NonNullable<EmployeeAccessAdminRecord['user']>['accessGrants'][number]> = {}) {
  const department = DEPARTMENTS.BUSINESS;
  return {
    id: 'grant-business',
    profile: AccessProfileKey.DEPARTMENT_FULL,
    departmentId: department.id,
    scopeKey: 'DEPARTMENT:BUSINESS',
    grantType: AccessGrantType.PRIMARY,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    effectiveTo: null,
    isActive: true,
    department,
    ...overrides,
  };
}

function employeeRecord(overrides: Partial<EmployeeAccessAdminRecord> = {}): EmployeeAccessAdminRecord {
  const department = DEPARTMENTS.BUSINESS;
  return {
    id: 'employee-1',
    employeeNo: 'HM-001',
    name: '测试员工',
    department: department.name,
    departmentId: department.id,
    position: '业务员',
    team: null,
    hireDate: new Date('2026-01-01T00:00:00.000Z'),
    mobile: '13800138000',
    wecomUserId: null,
    notificationEnabled: true,
    isActive: true,
    attendanceEnabled: true,
    attendanceGroup: 'OTHER',
    attainmentEligible: true,
    attainmentFactorBasisPoints: 10_000,
    attainmentStream: 'batch',
    resignedAt: null,
    resignationReason: null,
    resignationNote: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    departmentRef: department,
    fieldReportPinCredential: null,
    user: {
      id: 'user-1',
      username: 'employee-1',
      displayName: '测试员工',
      isActive: true,
      accountStatus: AccountStatus.ACTIVE,
      mustChangePassword: false,
      fieldPasswordOnly: false,
      lastLoginAt: null,
      accessGrants: [accessGrant()],
    },
    ...overrides,
  };
}

test('legacy Chinese department names resolve to stable codes', () => {
  assert.equal(departmentCodeFromLegacyText('生产车间'), 'PRODUCTION');
  assert.equal(departmentCodeFromLegacyText('  人力 资源部 '), 'HR');
  assert.equal(departmentCodeFromLegacyText('总经理办公室'), 'GM_OFFICE');
  assert.equal(departmentCodeFromLegacyText('QUALITY'), 'QUALITY');
  assert.equal(departmentCodeFromLegacyText('未配置部门'), null);
});

test('stable departmentId wins and synchronizes the canonical Chinese name', async () => {
  const lookups: unknown[] = [];
  const result = await resolveEmployeeDepartmentInput(
    { departmentId: DEPARTMENTS.QUALITY.id, department: '错误旧文本' },
    async lookup => {
      lookups.push(lookup);
      return lookup.id === DEPARTMENTS.QUALITY.id ? DEPARTMENTS.QUALITY : null;
    },
  );

  assert.deepEqual(lookups, [{ id: DEPARTMENTS.QUALITY.id }]);
  assert.deepEqual(result, {
    departmentId: DEPARTMENTS.QUALITY.id,
    department: '质量部',
    departmentRecord: DEPARTMENTS.QUALITY,
  });
});

test('legacy department input resolves through the stable code and empty input clears both fields', async () => {
  const result = await resolveEmployeeDepartmentInput(
    { department: '人力资源部' },
    async lookup => lookup.code === 'HR' ? DEPARTMENTS.HR : null,
  );
  assert.equal(result?.departmentId, DEPARTMENTS.HR.id);
  assert.equal(result?.department, DEPARTMENTS.HR.name);

  assert.deepEqual(
    await resolveEmployeeDepartmentInput({ departmentId: '', department: '' }, async () => null),
    { departmentId: null, department: null, departmentRecord: null },
  );
  assert.equal(
    await resolveEmployeeDepartmentInput({ name: 'no department change' }, async () => null),
    undefined,
  );
});

test('unknown or inactive departments fail closed', async () => {
  await assert.rejects(
    resolveEmployeeDepartmentInput({ department: '不存在的部门' }, async () => null),
    error => error instanceof EmployeeDepartmentInputError && error.status === 400,
  );
  await assert.rejects(
    resolveEmployeeDepartmentInput(
      { departmentId: 'inactive-department' },
      async () => ({ id: 'inactive-department', code: 'OLD', name: '旧部门', isActive: false }),
    ),
    error => error instanceof EmployeeDepartmentInputError,
  );
});

test('effective grants use an inclusive start and exclusive end boundary', () => {
  const grant = accessGrant({
    effectiveFrom: NOW,
    effectiveTo: new Date('2026-08-11T00:00:00.000Z'),
  });
  assert.equal(isEffectiveEmployeeGrant(grant, NOW), true);
  assert.equal(
    isEffectiveEmployeeGrant(grant, new Date('2026-08-11T00:00:00.000Z')),
    false,
  );
  assert.equal(isEffectiveEmployeeGrant({ ...grant, isActive: false }, NOW), false);
});

test('offboarding disables the linked account, invalidates sessions and deactivates every active grant', async () => {
  let grantUpdate: unknown;
  let userUpdate: unknown;
  let pinUpdate: unknown;
  let pinSessionUpdate: unknown;
  const tx = {
    user: {
      findUnique: async () => ({ id: 'user-1' }),
      update: async (args: unknown) => {
        userUpdate = args;
        return { id: 'user-1' };
      },
    },
    userAccessGrant: {
      updateMany: async (args: unknown) => {
        grantUpdate = args;
        return { count: 3 };
      },
    },
    employeeFieldReportPinCredential: {
      updateMany: async (args: unknown) => {
        pinUpdate = args;
        return { count: 1 };
      },
    },
    fieldReportPinSession: {
      updateMany: async (args: unknown) => {
        pinSessionUpdate = args;
        return { count: 2 };
      },
    },
  } as unknown as Pick<
    Prisma.TransactionClient,
    'user' | 'userAccessGrant' | 'employeeFieldReportPinCredential' | 'fieldReportPinSession'
  >;

  const result = await disableLinkedEmployeeAccess(tx, 'employee-1');

  assert.deepEqual(grantUpdate, {
    where: { userId: 'user-1', isActive: true },
    data: { isActive: false, version: { increment: 1 } },
  });
  assert.deepEqual(userUpdate, {
    where: { id: 'user-1' },
    data: {
      accountStatus: 'DISABLED',
      isActive: false,
      sessionVersion: { increment: 1 },
    },
  });
  assert.deepEqual(pinUpdate, {
    where: { employeeId: 'employee-1', isActive: true },
    data: {
      isActive: false,
      credentialVersion: { increment: 1 },
      failedAttempts: 0,
      lockedUntil: null,
    },
  });
  assert.deepEqual(pinSessionUpdate, {
    where: { employeeId: 'employee-1', consumedAt: null, revokedAt: null },
    data: { revokedAt: pinSessionUpdate && (pinSessionUpdate as { data: { revokedAt: Date } }).data.revokedAt },
  });
  assert.deepEqual(result, {
    linkedAccount: true,
    disabledAccessGrants: 3,
    sessionInvalidated: true,
    pinCredentialDisabled: true,
    pinSessionsRevoked: 2,
  });
});

test('offboarding without a linked account performs no account or grant writes', async () => {
  let writeCalled = false;
  const tx = {
    user: {
      findUnique: async () => null,
      update: async () => {
        writeCalled = true;
        return {};
      },
    },
    userAccessGrant: {
      updateMany: async () => {
        writeCalled = true;
        return { count: 0 };
      },
    },
    employeeFieldReportPinCredential: {
      updateMany: async () => ({ count: 0 }),
    },
    fieldReportPinSession: {
      updateMany: async () => ({ count: 0 }),
    },
  } as unknown as Pick<
    Prisma.TransactionClient,
    'user' | 'userAccessGrant' | 'employeeFieldReportPinCredential' | 'fieldReportPinSession'
  >;

  assert.deepEqual(await disableLinkedEmployeeAccess(tx, 'employee-without-user'), {
    linkedAccount: false,
    disabledAccessGrants: 0,
    sessionInvalidated: false,
    pinCredentialDisabled: false,
    pinSessionsRevoked: 0,
  });
  assert.equal(writeCalled, false);
});

test('matching primary department grant is synchronized while concurrent grants form a summary union', () => {
  const qualityGrant = accessGrant({
    id: 'grant-quality',
    grantType: AccessGrantType.CONCURRENT,
    departmentId: DEPARTMENTS.QUALITY.id,
    scopeKey: 'DEPARTMENT:QUALITY',
    department: DEPARTMENTS.QUALITY,
  });
  const employee = employeeRecord({
    user: {
      ...employeeRecord().user!,
      accessGrants: [accessGrant(), qualityGrant],
    },
  });

  assert.equal(employeePermissionSyncPending(employee, NOW), false);
  const serialized = serializeEmployeeAccessAdmin(employee, NOW);
  assert.equal(serialized.permissionSyncPending, false);
  assert.deepEqual(serialized.departmentRecord, DEPARTMENTS.BUSINESS);
  assert.deepEqual(serialized.linkedUser?.permissionSummary.profiles, ['DEPARTMENT_FULL']);
  assert.deepEqual(
    serialized.linkedUser?.permissionSummary.departmentCodes,
    ['BUSINESS', 'QUALITY'],
  );
  assert.equal(serialized.linkedUser?.permissionSummary.activeGrantCount, 2);
  assert.equal('accessGrants' in (serialized.linkedUser ?? {}), false);
});

test('department changes never rewrite grants and are reported as permissionSyncPending', () => {
  const employee = employeeRecord({
    departmentId: DEPARTMENTS.QUALITY.id,
    department: DEPARTMENTS.QUALITY.name,
    departmentRef: DEPARTMENTS.QUALITY,
  });

  assert.equal(employee.user?.accessGrants[0]?.departmentId, DEPARTMENTS.BUSINESS.id);
  assert.equal(employeePermissionSyncPending(employee, NOW), true);
  assert.equal(serializeEmployeeAccessAdmin(employee, NOW).permissionSyncPending, true);
});

test('inactive grants remain disabled after reinstatement and require administrator confirmation', () => {
  const disabledGrant = accessGrant({ isActive: false });
  const employee = employeeRecord({
    isActive: true,
    user: {
      ...employeeRecord().user!,
      isActive: false,
      accountStatus: AccountStatus.DISABLED,
      accessGrants: [disabledGrant],
    },
  });

  const serialized = serializeEmployeeAccessAdmin(employee, NOW);
  assert.equal(serialized.linkedUser?.isActive, false);
  assert.equal(serialized.linkedUser?.accountStatus, 'DISABLED');
  assert.equal(serialized.linkedUser?.permissionSummary.activeGrantCount, 0);
  assert.equal(serialized.permissionSyncPending, true);
});

test('offboarded employees are fully disabled instead of becoming permission sync tasks', () => {
  const employee = employeeRecord({
    isActive: false,
    user: {
      ...employeeRecord().user!,
      isActive: false,
      accountStatus: AccountStatus.DISABLED,
      accessGrants: [accessGrant({ isActive: false })],
    },
  });

  const serialized = serializeEmployeeAccessAdmin(employee, NOW);
  assert.equal(serialized.permissionSyncPending, false);
  assert.equal(serialized.linkedUser?.permissionSummary.permissionSyncPending, false);
  assert.equal(serialized.linkedUser?.permissionSummary.activeGrantCount, 0);
});

test('global administrator grants are not tied to an employee department', () => {
  const adminGrant = accessGrant({
    profile: AccessProfileKey.ADMIN_GLOBAL,
    departmentId: null,
    department: null,
    scopeKey: 'GLOBAL',
  });
  const employee = employeeRecord({
    departmentId: DEPARTMENTS.QUALITY.id,
    user: {
      ...employeeRecord().user!,
      accessGrants: [adminGrant],
    },
  });
  assert.equal(employeePermissionSyncPending(employee, NOW), false);
});

test('an employee without a linked account has no permission sync work', () => {
  const employee = employeeRecord({ user: null });
  const serialized = serializeEmployeeAccessAdmin(employee, NOW);
  assert.equal(serialized.linkedUser, null);
  assert.equal(serialized.permissionSyncPending, false);
});
