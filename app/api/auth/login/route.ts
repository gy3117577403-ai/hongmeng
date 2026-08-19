import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { createToken, cookieOptions } from '@/lib/auth';
import {
  FIELD_REPORT_PIN_SESSION_COOKIE,
  FIELD_REPORT_TERMINAL_COOKIE,
  SESSION_COOKIE,
} from '@/lib/constants';
import { logOp } from '@/lib/logs';
import {
  canAcceptPasswordCredential,
  canUseDefaultFieldPassword,
  canIssuePasswordSession,
  FIELD_REPORT_DEFAULT_PASSWORD,
  isLoginLocked,
  nextFailedLoginState,
} from '@/lib/login-security';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INVALID_PASSWORD_HASH = bcrypt.hashSync('hm-invalid-login-sentinel', 10);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { username?: string; password?: string; rememberDevice?: boolean };
    const loginId = body.username?.trim();
    const password = body.password || '';
    const rememberDevice = body.rememberDevice === true;
    if (!loginId || !password) {
      return NextResponse.json({ message: '请输入员工编号（或管理账号）和密码' }, { status: 400 });
    }
    const now = new Date();
    const loginAccountInclude = {
      employee: { select: { employeeNo: true, name: true, isActive: true } },
      accessGrants: {
        select: {
          profile: true,
          isActive: true,
          effectiveFrom: true,
          effectiveTo: true,
        },
      },
    } as const;
    const [directAccount, employeeAccount] = await Promise.all([
      prisma.user.findUnique({ where: { username: loginId }, include: loginAccountInclude }),
      prisma.user.findFirst({
        where: { employee: { employeeNo: loginId } },
        include: loginAccountInclude,
      }),
    ]);
    // Employee-number login is the field-report identity source of truth. This
    // also makes a rare cross-field collision with a management username deterministic.
    const user = employeeAccount || directAccount;
    const linkedEmployeeDisabled = Boolean(user?.employee && !user.employee.isActive);
    if (user && isLoginLocked(user.lockedUntil, now)) {
      return NextResponse.json(
        { message: '登录尝试过多，请 15 分钟后再试或联系管理员重置密码' },
        { status: 429, headers: { 'Retry-After': '900' } },
      );
    }
    const passwordMatches = await bcrypt.compare(password, user?.passwordHash || INVALID_PASSWORD_HASH);
    const passwordSessionAllowed = Boolean(user && canIssuePasswordSession(user, now));
    const passwordCredentialAccepted = Boolean(
      user && canAcceptPasswordCredential(user, password, passwordMatches, now),
    );
    const usedFieldDefaultFallback = Boolean(
      user
      && !passwordMatches
      && password === FIELD_REPORT_DEFAULT_PASSWORD
      && canUseDefaultFieldPassword(user, now),
    );
    if (
      !user
      || !passwordSessionAllowed
      || linkedEmployeeDisabled
      || !passwordCredentialAccepted
    ) {
      if (user && passwordSessionAllowed && !linkedEmployeeDisabled) {
        await prisma.$transaction(async tx => {
          const counter = await tx.user.update({
            where: { id: user.id },
            data: { failedLoginAttempts: { increment: 1 } },
            select: { failedLoginAttempts: true },
          });
          const lockState = nextFailedLoginState(counter.failedLoginAttempts - 1, now);
          if (lockState.lockedUntil) {
            await tx.user.update({
              where: { id: user.id },
              data: { lockedUntil: lockState.lockedUntil },
            });
          }
        });
      }
      return NextResponse.json({ message: '员工编号、账号或密码错误' }, { status: 401 });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: now,
        failedLoginAttempts: 0,
        lockedUntil: null,
        // Repair only accounts that received an unrecoverable random password
        // during the PIN-only release. Existing working hashes are untouched.
        ...(usedFieldDefaultFallback
          ? { passwordHash: await bcrypt.hash(FIELD_REPORT_DEFAULT_PASSWORD, 10) }
          : {}),
      },
    });
    const response = NextResponse.json({
      ok: true,
      displayName: user.employee?.name || user.displayName,
      employeeNo: user.employee?.employeeNo || null,
      mustChangePassword: user.mustChangePassword,
    });
    // A deliberate password login exits shared-terminal mode. This prevents a
    // stale terminal cookie from silently taking precedence over the new user.
    response.cookies.delete(FIELD_REPORT_TERMINAL_COOKIE);
    response.cookies.delete(FIELD_REPORT_PIN_SESSION_COOKIE);
    response.cookies.set(
      SESSION_COOKIE,
      createToken({
        userId: user.id,
        username: user.username,
        sessionVersion: user.sessionVersion,
      }, { rememberDevice }),
      cookieOptions({ rememberDevice }),
    );
    await logOp({
      userId: user.id,
      action: 'login',
      targetType: 'user',
      targetId: user.id,
      detail: {
        loginMethod: user.employee?.employeeNo === loginId ? 'employee_no' : 'username',
        rememberDevice,
      },
    });
    return response;
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: '登录服务异常' }, { status: 500 });
  }
}
