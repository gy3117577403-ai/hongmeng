import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { createToken, cookieOptions } from '@/lib/auth';
import { SESSION_COOKIE } from '@/lib/constants';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { username?: string; password?: string };
    const loginId = body.username?.trim();
    const password = body.password || '';
    if (!loginId || !password) {
      return NextResponse.json({ message: '请输入员工编号（或管理账号）和密码' }, { status: 400 });
    }
    const employeeInclude = {
      employee: { select: { employeeNo: true, name: true, isActive: true } },
    } as const;
    const [directAccount, employeeAccount] = await Promise.all([
      prisma.user.findUnique({ where: { username: loginId }, include: employeeInclude }),
      prisma.user.findFirst({ where: { employee: { employeeNo: loginId } }, include: employeeInclude }),
    ]);
    // Employee-number login is the field-report identity source of truth. This
    // also makes a rare cross-field collision with a management username deterministic.
    const user = employeeAccount || directAccount;
    const linkedEmployeeDisabled = Boolean(user?.employee && !user.employee.isActive);
    if (!user || !user.isActive || linkedEmployeeDisabled || !(await bcrypt.compare(password, user.passwordHash))) {
      return NextResponse.json({ message: '员工编号、账号或密码错误' }, { status: 401 });
    }
    const response = NextResponse.json({
      ok: true,
      displayName: user.employee?.name || user.displayName,
      employeeNo: user.employee?.employeeNo || null,
    });
    response.cookies.set(
      SESSION_COOKIE,
      createToken({ userId: user.id, username: user.username }),
      cookieOptions(),
    );
    await logOp({
      userId: user.id,
      action: 'login',
      targetType: 'user',
      targetId: user.id,
      detail: { loginMethod: user.employee?.employeeNo === loginId ? 'employee_no' : 'username' },
    });
    return response;
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: '登录服务异常' }, { status: 500 });
  }
}
