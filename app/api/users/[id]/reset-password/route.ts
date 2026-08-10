import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import {
  forbidden,
  ForbiddenError,
  requireAdmin,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { validateNewPassword } from '@/lib/password-policy';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const current = await requireAdmin();
    const body = await req.json().catch(() => ({})) as { password?: string };
    const password = String(body.password || '');

    const old = await prisma.user.findUnique({ where: { id: params.id } });
    if (!old) return NextResponse.json({ ok: false, error: '账号不存在' }, { status: 404 });
    const passwordError = validateNewPassword(password, old.username);
    if (passwordError) return NextResponse.json({ ok: false, error: passwordError }, { status: 400 });

    await prisma.user.update({
      where: { id: params.id },
      data: {
        passwordHash: await bcrypt.hash(password, 10),
        mustChangePassword: true,
        sessionVersion: { increment: 1 },
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    await logOp({ userId: current.id, action: 'reset_user_password', targetType: 'user', targetId: old.id, detail: { username: old.username } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    if (e instanceof ForbiddenError) return forbidden('只有管理员可以重置其他账号密码');
    return NextResponse.json({ ok: false, error: '重置密码失败' }, { status: 500 });
  }
}
