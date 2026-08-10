import { AccessProfileKey } from '@prisma/client';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import { ForbiddenError } from '@/lib/auth';
import {
  FIELD_REPORT_PIN_SESSION_COOKIE,
  FIELD_REPORT_TERMINAL_COOKIE,
} from '@/lib/constants';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { prisma } from '@/lib/prisma';
import { isProductionWorkforceEmployee } from '@/lib/production-workforce';
import {
  hashFieldReportSessionToken,
  hashFieldReportTerminalSecret,
  verifyFieldReportSessionToken,
  verifyFieldReportTerminalSecret,
} from '@/lib/field-report-pin-security';

export const FIELD_REPORT_PIN_SESSION_TTL_SECONDS = 5 * 60;
export const FIELD_REPORT_TERMINAL_COOKIE_TTL_SECONDS = 365 * 24 * 60 * 60;
export const FIELD_REPORT_PIN_MAX_FAILED_ATTEMPTS = 5;
export const FIELD_REPORT_TERMINAL_MAX_FAILED_ATTEMPTS = 20;
export const FIELD_REPORT_LOCK_DURATION_MS = 15 * 60 * 1000;

const OPAQUE_SECRET_PATTERN = /^[A-Za-z0-9_-]{32,180}$/;

export class FieldReportPinAuthError extends Error {
  constructor(
    message = '共享终端身份验证失败，请重新输入员工编号和 PIN',
    public readonly status = 401,
    public readonly code = 'FIELD_REPORT_PIN_AUTH_FAILED',
  ) {
    super(message);
    this.name = 'FieldReportPinAuthError';
  }
}

export type FieldReportTerminalContext = {
  id: string;
  name: string;
  location: string | null;
  version: number;
  failedAttempts: number;
  lockedUntil: Date | null;
};

export type FieldReportPinPrincipal = {
  kind: 'pin';
  sessionId: string;
  tokenHash: string;
  terminalId: string;
  terminalVersion: number;
  credentialId: string;
  credentialVersion: number;
  ticketId: string;
  userId: string;
  consumedAt: Date | null;
  employee: {
    id: string;
    employeeNo: string;
    name: string;
    department: string | null;
    position: string | null;
    team: string | null;
  };
};

export function isFieldReportPinFormat(value: unknown): boolean {
  return /^\d{6}$/.test(String(value ?? ''));
}

export function isFieldReportLocked(
  lockedUntil: Date | null | undefined,
  now = new Date(),
): boolean {
  return Boolean(lockedUntil && lockedUntil.getTime() > now.getTime());
}

export function canAttemptFieldReportCompletion(input: {
  routeAvailable: boolean;
  canReport: boolean;
  pinSessionConsumed: boolean;
}): boolean {
  return input.routeAvailable && (input.canReport || input.pinSessionConsumed);
}

export function fieldReportLockUntil(
  failedAttempts: number,
  limit: number,
  now = new Date(),
): Date | null {
  return failedAttempts >= limit
    ? new Date(now.getTime() + FIELD_REPORT_LOCK_DURATION_MS)
    : null;
}

export function assertFieldReportJsonMutation(request: Request): void {
  assertFieldReportBrowserMutation(request);
  const mediaType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw new FieldReportPinAuthError(
      '请求格式错误',
      415,
      'FIELD_REPORT_JSON_REQUIRED',
    );
  }
}

/**
 * Shared-terminal cookies are stronger than an ordinary browser session only
 * when every mutation is tied to the exact origin. In production, both Origin
 * and Fetch Metadata are mandatory. Local API tests may omit Fetch Metadata,
 * but must still provide a valid Origin.
 */
export function assertFieldReportBrowserMutation(request: Request): void {
  assertSameOriginMutationRequest(request);
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  const localOriginFallback = process.env.NODE_ENV !== 'production'
    && Boolean(origin)
    && !fetchSite;
  if (!origin || (fetchSite !== 'same-origin' && !localOriginFallback)) {
    throw new ForbiddenError('共享终端仅接受当前站点发起的请求');
  }
}

export function fieldReportTerminalCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: FIELD_REPORT_TERMINAL_COOKIE_TTL_SECONDS,
  };
}

export function fieldReportPinSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: FIELD_REPORT_PIN_SESSION_TTL_SECONDS,
  };
}

export function setFieldReportTerminalCookie(response: NextResponse, secret: string): void {
  response.cookies.set(
    FIELD_REPORT_TERMINAL_COOKIE,
    secret,
    fieldReportTerminalCookieOptions(),
  );
}

export function setFieldReportPinSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(
    FIELD_REPORT_PIN_SESSION_COOKIE,
    token,
    fieldReportPinSessionCookieOptions(),
  );
}

export function clearFieldReportPinSessionCookie(response: NextResponse): void {
  response.cookies.delete(FIELD_REPORT_PIN_SESSION_COOKIE);
}

export function clearFieldReportTerminalCookies(response: NextResponse): void {
  response.cookies.delete(FIELD_REPORT_TERMINAL_COOKIE);
  response.cookies.delete(FIELD_REPORT_PIN_SESSION_COOKIE);
}

function cookieSecret(name: string): string | null {
  const value = cookies().get(name)?.value || '';
  return OPAQUE_SECRET_PATTERN.test(value) ? value : null;
}

export async function resolveFieldReportTerminal(): Promise<FieldReportTerminalContext | null> {
  const secret = cookieSecret(FIELD_REPORT_TERMINAL_COOKIE);
  if (!secret) return null;
  const terminal = await prisma.fieldReportTerminal.findUnique({
    where: { secretHash: hashFieldReportTerminalSecret(secret) },
    select: {
      id: true,
      name: true,
      location: true,
      version: true,
      isActive: true,
      failedAttempts: true,
      lockedUntil: true,
      secretHash: true,
    },
  });
  if (!terminal?.isActive || !verifyFieldReportTerminalSecret(secret, terminal.secretHash)) return null;
  return {
    id: terminal.id,
    name: terminal.name,
    location: terminal.location,
    version: terminal.version,
    failedAttempts: terminal.failedAttempts,
    lockedUntil: terminal.lockedUntil,
  };
}

type LiveReporterAccount = {
  id: string;
  isActive: boolean;
  accountStatus: string;
  employeeId: string | null;
  accessGrants: Array<{
    profile: AccessProfileKey;
    scopeKey: string;
    isActive: boolean;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  }>;
};

export function hasLiveFieldReporterGrant(
  user: LiveReporterAccount | null | undefined,
  employeeId: string,
  now = new Date(),
): user is LiveReporterAccount {
  if (
    !user
    || !user.isActive
    || user.accountStatus !== 'ACTIVE'
    || user.employeeId !== employeeId
  ) return false;
  const expectedScope = `EMPLOYEE:${employeeId}`;
  return user.accessGrants.some(grant => (
    grant.profile === AccessProfileKey.FIELD_REPORTER
    && grant.scopeKey === expectedScope
    && grant.isActive
    && grant.effectiveFrom.getTime() <= now.getTime()
    && (!grant.effectiveTo || grant.effectiveTo.getTime() > now.getTime())
  ));
}

async function resolveFieldReportPinPrincipalInternal(
  code: string,
  terminalInput?: FieldReportTerminalContext | null,
  allowConsumedReplay = false,
): Promise<FieldReportPinPrincipal | null> {
  const now = new Date();
  const terminal = terminalInput === undefined
    ? await resolveFieldReportTerminal()
    : terminalInput;
  if (!terminal || isFieldReportLocked(terminal.lockedUntil, now)) return null;
  const token = cookieSecret(FIELD_REPORT_PIN_SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = hashFieldReportSessionToken(token);
  const session = await prisma.fieldReportPinSession.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      terminalId: true,
      terminalVersion: true,
      credentialId: true,
      credentialVersion: true,
      employeeId: true,
      ticketId: true,
      expiresAt: true,
      consumedAt: true,
      revokedAt: true,
      tokenHash: true,
      terminal: {
        select: {
          isActive: true,
          version: true,
          lockedUntil: true,
        },
      },
      credential: {
        select: {
          employeeId: true,
          isActive: true,
          credentialVersion: true,
          lockedUntil: true,
        },
      },
      employee: {
        select: {
          id: true,
          employeeNo: true,
          name: true,
          department: true,
          position: true,
          team: true,
          isActive: true,
          attendanceEnabled: true,
        },
      },
      user: {
        select: {
          id: true,
          isActive: true,
          accountStatus: true,
          employeeId: true,
          accessGrants: {
            where: { profile: AccessProfileKey.FIELD_REPORTER },
            select: {
              profile: true,
              scopeKey: true,
              isActive: true,
              effectiveFrom: true,
              effectiveTo: true,
            },
          },
        },
      },
      ticket: { select: { id: true, publicCode: true, status: true } },
    },
  });
  if (
    !session
    || !verifyFieldReportSessionToken(token, session.tokenHash)
    || session.terminalId !== terminal.id
    || session.terminalVersion !== terminal.version
    || session.terminal.version !== terminal.version
    || !session.terminal.isActive
    || isFieldReportLocked(session.terminal.lockedUntil, now)
    || session.credentialId === ''
    || session.credential.employeeId !== session.employeeId
    || session.credentialVersion !== session.credential.credentialVersion
    || !session.credential.isActive
    || isFieldReportLocked(session.credential.lockedUntil, now)
    || session.ticketId !== session.ticket.id
    || session.ticket.publicCode !== code
    || session.ticket.status !== 'ACTIVE'
    || session.expiresAt.getTime() <= now.getTime()
    || (!allowConsumedReplay && session.consumedAt)
    || session.revokedAt
    || !isProductionWorkforceEmployee(session.employee)
    || !hasLiveFieldReporterGrant(session.user, session.employeeId, now)
  ) return null;

  return {
    kind: 'pin',
    sessionId: session.id,
    tokenHash,
    terminalId: terminal.id,
    terminalVersion: terminal.version,
    credentialId: session.credentialId,
    credentialVersion: session.credentialVersion,
    ticketId: session.ticketId,
    userId: session.user.id,
    consumedAt: session.consumedAt,
    employee: {
      id: session.employee.id,
      employeeNo: session.employee.employeeNo,
      name: session.employee.name,
      department: session.employee.department,
      position: session.employee.position,
      team: session.employee.team,
    },
  };
}

export async function resolveFieldReportPinPrincipal(
  code: string,
  terminalInput?: FieldReportTerminalContext | null,
): Promise<FieldReportPinPrincipal | null> {
  return resolveFieldReportPinPrincipalInternal(code, terminalInput, false);
}

/**
 * Completion retries are the only place where a consumed PIN session may be
 * resolved. The process-completion transaction still verifies that the same
 * cookie, session and idempotency key belong to an already committed report.
 */
export async function resolveFieldReportPinCompletionPrincipal(
  code: string,
  terminalInput?: FieldReportTerminalContext | null,
): Promise<FieldReportPinPrincipal | null> {
  return resolveFieldReportPinPrincipalInternal(code, terminalInput, true);
}

export async function revokeCurrentFieldReportPinSession(): Promise<void> {
  const token = cookieSecret(FIELD_REPORT_PIN_SESSION_COOKIE);
  if (!token) return;
  await prisma.fieldReportPinSession.updateMany({
    where: {
      tokenHash: hashFieldReportSessionToken(token),
      consumedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}
