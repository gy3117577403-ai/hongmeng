import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/constants';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const sessionUser = await requireUser();
    const body = await req.json() as {
      currentPassword?: string;
      newPassword?: string;
      confirmPassword?: string;
    };

    const currentPassword = body.currentPassword || '';
    const newPassword = body.newPassword || '';
    const confirmPassword = body.confirmPassword || '';

    if (!currentPassword || !newPassword || !confirmPassword) {
      return NextResponse.json({ message: '请完整填写密码信息' }, { status: 400 });
    }

    if (newPassword.length < 6) {
      return NextResponse.json({ message: '新密码至少 6 位' }, { status: 400 });
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json({ message: '两次输入的新密码不一致' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: sessionUser.id } });
    if (!user || !user.isActive) {
      return unauthorized();
    }

    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return NextResponse.json({ message: '当前密码不正确' }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
    await logOp({ userId: user.id, action: 'change_password', targetType: 'user', targetId: user.id });

    const res = NextResponse.json({ ok: true, message: '密码已修改，请重新登录' });
    res.cookies.set(SESSION_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0,
    });
    return res;
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ message: '修改密码失败' }, { status: 500 });
  }
}
