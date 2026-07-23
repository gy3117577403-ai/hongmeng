export type LaborAccessRoleValue = 'ADMIN' | 'TEAM_LEAD' | 'EMPLOYEE';

export type LaborAuthorizationActor = {
  id: string;
  isActive: boolean;
  laborRole: LaborAccessRoleValue;
  employee: {
    id: string;
    isActive: boolean;
    team: string | null;
  } | null;
};

export type LaborAuthorizationTarget = {
  id: string;
  isActive: boolean;
  team: string | null;
};

export type LaborAccessProfile = {
  role: LaborAccessRoleValue;
  selfEmployeeId: string | null;
  team: string | null;
  canClaim: boolean;
  canAssignOthers: boolean;
  canVoid: boolean;
  canResolveStandard: boolean;
  blockedReason: string | null;
};

export class LaborAuthorizationError extends Error {
  readonly status = 403;
  readonly code: string;

  constructor(message: string, code = 'PROCESS_LABOR_FORBIDDEN') {
    super(message);
    this.name = 'LaborAuthorizationError';
    this.code = code;
  }
}

function normalizedTeam(value: string | null | undefined): string {
  return String(value || '').trim();
}

export function laborAccessProfile(actor: LaborAuthorizationActor): LaborAccessProfile {
  if (!actor.isActive) {
    return {
      role: actor.laborRole,
      selfEmployeeId: null,
      team: null,
      canClaim: false,
      canAssignOthers: false,
      canVoid: false,
      canResolveStandard: false,
      blockedReason: '账号已停用',
    };
  }
  if (actor.laborRole === 'ADMIN') {
    return {
      role: actor.laborRole,
      selfEmployeeId: actor.employee?.isActive ? actor.employee.id : null,
      team: actor.employee?.isActive ? normalizedTeam(actor.employee.team) || null : null,
      canClaim: true,
      canAssignOthers: true,
      canVoid: true,
      canResolveStandard: true,
      blockedReason: null,
    };
  }
  if (!actor.employee || !actor.employee.isActive) {
    return {
      role: actor.laborRole,
      selfEmployeeId: null,
      team: null,
      canClaim: false,
      canAssignOthers: false,
      canVoid: false,
      canResolveStandard: false,
      blockedReason: '账号未绑定在职员工档案',
    };
  }
  if (actor.laborRole === 'TEAM_LEAD') {
    const team = normalizedTeam(actor.employee.team);
    return {
      role: actor.laborRole,
      selfEmployeeId: actor.employee.id,
      team: team || null,
      canClaim: Boolean(team),
      canAssignOthers: Boolean(team),
      canVoid: Boolean(team),
      canResolveStandard: false,
      blockedReason: team ? null : '班组长账号绑定的员工档案未设置班组',
    };
  }
  return {
    role: actor.laborRole,
    selfEmployeeId: actor.employee.id,
    team: normalizedTeam(actor.employee.team) || null,
    canClaim: true,
    canAssignOthers: false,
    canVoid: false,
    canResolveStandard: false,
    blockedReason: null,
  };
}

function requireConfiguredAccess(actor: LaborAuthorizationActor): LaborAccessProfile {
  const access = laborAccessProfile(actor);
  if (access.blockedReason) {
    throw new LaborAuthorizationError(
      access.blockedReason,
      'PROCESS_LABOR_ACTOR_NOT_CONFIGURED',
    );
  }
  return access;
}

export function authorizeLaborClaim(
  actor: LaborAuthorizationActor,
  target: LaborAuthorizationTarget,
): void {
  const access = requireConfiguredAccess(actor);
  if (!target.isActive) {
    throw new LaborAuthorizationError(
      '目标员工已停用，不能领取工时',
      'PROCESS_LABOR_TARGET_EMPLOYEE_INACTIVE',
    );
  }
  if (access.role === 'ADMIN') return;
  if (access.role === 'EMPLOYEE') {
    if (target.id !== access.selfEmployeeId) {
      throw new LaborAuthorizationError(
        '员工账号只能领取到本人',
        'PROCESS_LABOR_SELF_CLAIM_ONLY',
      );
    }
    return;
  }
  if (!access.team || normalizedTeam(target.team) !== access.team) {
    throw new LaborAuthorizationError(
      '班组长只能分配本班组员工的工时',
      'PROCESS_LABOR_TEAM_SCOPE_FORBIDDEN',
    );
  }
}

export function authorizeLaborVoid(
  actor: LaborAuthorizationActor,
  target: LaborAuthorizationTarget,
): void {
  const access = requireConfiguredAccess(actor);
  if (access.role === 'ADMIN') return;
  if (access.role === 'EMPLOYEE') {
    throw new LaborAuthorizationError(
      '员工领取记录需由班组长或管理员冲销',
      'PROCESS_LABOR_VOID_FORBIDDEN',
    );
  }
  if (!access.team || normalizedTeam(target.team) !== access.team) {
    throw new LaborAuthorizationError(
      '班组长只能冲销本班组员工的领取记录',
      'PROCESS_LABOR_TEAM_SCOPE_FORBIDDEN',
    );
  }
}

export function authorizeLaborStandardResolution(actor: LaborAuthorizationActor): void {
  const access = requireConfiguredAccess(actor);
  if (!access.canResolveStandard) {
    throw new LaborAuthorizationError(
      '只有管理员可以补录并解锁工时标准',
      'PROCESS_LABOR_STANDARD_FORBIDDEN',
    );
  }
}

export function canViewLaborClaim(
  access: LaborAccessProfile,
  target: LaborAuthorizationTarget,
): boolean {
  if (access.role === 'ADMIN') return true;
  if (access.role === 'EMPLOYEE') return target.id === access.selfEmployeeId;
  return Boolean(access.team && normalizedTeam(target.team) === access.team);
}
