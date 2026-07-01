import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const current = await requireUser();
    const body = await req.json().catch(() => ({})) as { password?: string };
    const password = String(body.password || '');
    if (password.length < 6) return NextResponse.json({ ok: false, error: '新密码至少 6 位' }, { status: 400 });

    const old = await prisma.user.findUnique({ where: { id: params.id } });
    if (!old) return NextResponse.json({ ok: false, error: '账号不存在' }, { status: 404 });

    await prisma.user.update({ where: { id: params.id }, data: { passwordHash: await bcrypt.hash(password, 10) } });
    await logOp({ userId: current.id, action: 'reset_user_password', targetType: 'user', targetId: old.id, detail: { username: old.username } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    return NextResponse.json({ ok: false, error: '重置密码失败' }, { status: 500 });
  }
}
