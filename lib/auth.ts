import crypto from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/constants';
import { canAccessApiRoute } from '@/lib/api-route-access';
import { dailyPlanEnabled } from '@/lib/daily-plan-feature';
import {
  DEPARTMENT_CODES,
  hasCapability,
  resolveAccessContext,
  type AccessActionCode,
  type AccessGrant,
  type AccessModuleCode,
  type AccessProfileCode,
  type DepartmentCode,
} from '@/lib/department-access';
import { legacyFallbackGrants } from '@/lib/legacy-access-policy';
import { prisma } from '@/lib/prisma';
import { productionPlanningDateBoundary } from '@/lib/production-planning-date';
import {
  canUseRequestMethod,
  type WriteAccessMode,
} from '@/lib/request-authorization';

export type Session = {
  userId: string;
  username: string;
  exp: number;
  sessionVersion?: number;
};

export class UnauthorizedError extends Error {}
export class ForbiddenError extends Error {}

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) throw new Error('SESSION_SECRET missing or too short');
  return value;
}

function sign(payload: string) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function createToken(user: {
  userId: string;
  username: string;
  sessionVersion?: number;
}) {
  const payload = Buffer.from(JSON.stringify({
    userId: user.userId,
    username: user.username,
    sessionVersion: user.sessionVersion ?? 0,
    exp: Math.floor(Date.now() / 1000) + 604800,
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token?: string | null): Session | null {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (
    signature.length !== expected.length
    || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
    return value.exp > Math.floor(Date.now() / 1000) ? value : null;
  } catch {
    return null;
  }
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 604800,
  };
}

function departmentCode(value?: string | null): DepartmentCode | null {
  return DEPARTMENT_CODES.includes(value as DepartmentCode) ? value as DepartmentCode : null;
}

export async function currentUser() {
  const session = verifyToken(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const membershipDate = productionPlanningDateBoundary();
  const now = new Date();
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      username: true,
      displayName: true,
      isActive: true,
      accountStatus: true,
      sessionVersion: true,
      mustChangePassword: true,
      lastLoginAt: true,
      laborRole: true,
      employeeId: true,
      accessGrants: {
        select: {
          id: true,
          profile: true,
          scopeKey: true,
          grantType: true,
          effectiveFrom: true,
          effectiveTo: true,
          isActive: true,
          department: { select: { code: true } },
        },
      },
      employee: {
        select: {
          id: true,
          employeeNo: true,
          name: true,
          department: true,
          departmentId: true,
          position: true,
          team: true,
          isActive: true,
          departmentRef: { select: { code: true, name: true } },
          productionPlanningMemberships: {
            where: {
              isActive: true,
              effectiveFrom: { lte: membershipDate },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: membershipDate } }],
            },
            select: { role: true, teamId: true },
          },
        },
      },
    },
  });
  if (
    !user
    || !user.isActive
    || user.accountStatus !== 'ACTIVE'
    || (session.sessionVersion ?? 0) !== user.sessionVersion
  ) return null;

  const memberships = user.employee?.productionPlanningMemberships ?? [];
  const dailyPlanningRoles = [...new Set(memberships.map(item => item.role))];
  const dailyPlanningTeamIds = [...new Set(
    memberships.map(item => item.teamId).filter((teamId): teamId is string => Boolean(teamId)),
  )];
  const explicitlyConfigured = dailyPlanningRoles.some(
    role => role === 'WORKSHOP_SUPERVISOR' || role === 'TEAM_LEADER',
  );
  const storedGrants: AccessGrant[] = user.accessGrants.map(grant => ({
    id: grant.id,
    profile: grant.profile as AccessProfileCode,
    grantType: grant.grantType,
    departmentCode: departmentCode(grant.department?.code),
    scopeKey: grant.scopeKey,
    isActive: grant.isActive,
    effectiveFrom: grant.effectiveFrom,
    effectiveTo: grant.effectiveTo,
  }));
  const compatibilityGrants = user.laborRole === 'ADMIN'
    ? legacyFallbackGrants(user)
    : [];
  const access = resolveAccessContext(
    storedGrants.length
      ? [...storedGrants, ...compatibilityGrants]
      : legacyFallbackGrants(user),
    { accountActive: true, now },
  );

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    accountStatus: user.accountStatus,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt?.toISOString() || null,
    laborRole: user.laborRole,
    employeeId: user.employeeId,
    accessConfigured: storedGrants.length > 0,
    employee: user.employee ? {
      id: user.employee.id,
      employeeNo: user.employee.employeeNo,
      name: user.employee.name,
      department: user.employee.departmentRef?.name || user.employee.department,
      departmentId: user.employee.departmentId,
      position: user.employee.position,
      team: user.employee.team,
      isActive: user.employee.isActive,
    } : null,
    access,
    dailyPlanningRoles,
    dailyPlanningTeamIds,
    canAccessDailyPlans: dailyPlanEnabled() && (
      user.laborRole === 'ADMIN'
      || explicitlyConfigured
      || access.modules.includes('PLANNING')
      || access.modules.includes('PRODUCTION')
    ),
    canManageDailyPlanningOrganization: user.laborRole === 'ADMIN'
      || hasCapability(access, 'SYSTEM_CONFIGURATION', 'MANAGE'),
  };
}

export async function requireUser(options?: {
  write?: WriteAccessMode;
  allowPasswordChange?: boolean;
}) {
  const user = await currentUser();
  if (!user) throw new UnauthorizedError();
  if (user.mustChangePassword && options?.allowPasswordChange !== true) {
    throw new UnauthorizedError('首次登录或密码重置后必须先修改密码');
  }
  const requestMethod = headers().get('x-hm-request-method');
  if (options?.allowPasswordChange === true) return user;
  const requestPath = headers().get('x-hm-request-path');
  const routeAllowed = requestPath
    ? canAccessApiRoute(user.access, requestPath, requestMethod)
    : null;
  if (routeAllowed === false || (routeAllowed === null && user.accessConfigured && user.laborRole !== 'ADMIN')) {
    throw new UnauthorizedError();
  }
  if (routeAllowed === true) return user;
  if (!canUseRequestMethod(user.laborRole, requestMethod, options?.write)) {
    throw new UnauthorizedError();
  }
  return user;
}

export async function requireCapability(
  module: AccessModuleCode,
  action: AccessActionCode,
) {
  const user = await currentUser();
  if (!user) throw new UnauthorizedError();
  if (user.mustChangePassword) throw new UnauthorizedError('首次登录或密码重置后必须先修改密码');
  if (!hasCapability(user.access, module, action)) throw new ForbiddenError();
  return user;
}

export async function requireAdmin() {
  const user = await currentUser();
  if (!user) throw new UnauthorizedError();
  if (user.mustChangePassword) throw new UnauthorizedError('首次登录或密码重置后必须先修改密码');
  if (
    user.laborRole !== 'ADMIN'
    && !hasCapability(user.access, 'ACCOUNT_ADMIN', 'MANAGE')
  ) throw new ForbiddenError();
  return user;
}

export function unauthorized() {
  const authenticated = !!verifyToken(cookies().get(SESSION_COOKIE)?.value);
  const message = authenticated ? '当前账号没有执行此操作的权限' : '未登录或登录已过期';
  return NextResponse.json({ ok: false, error: message, message }, { status: authenticated ? 403 : 401 });
}

export function forbidden(message = '当前账号没有执行此操作的权限') {
  return NextResponse.json({ ok: false, error: message, message }, { status: 403 });
}
