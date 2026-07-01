import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serializeUser(user: { id: string; username: string; displayName: string; isActive: boolean; createdAt: Date; updatedAt: Date }) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export async function GET() {
  try {
    await requireUser();
    const users = await prisma.user.findMany({ orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }] });
    return NextResponse.json({ ok: true, users: users.map(serializeUser) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    return NextResponse.json({ ok: false, error: '账号列表加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const current = await requireUser();
    const body = await req.json().catch(() => ({})) as { username?: string; displayName?: string; password?: string };
    const username = String(body.username || '').trim();
    const displayName = String(body.displayName || '').trim() || username;
    const password = String(body.password || '');

    if (!username) return NextResponse.json({ ok: false, error: '账号不能为空' }, { status: 400 });
    if (password.length < 6) return NextResponse.json({ ok: false, error: '初始密码至少 6 位' }, { status: 400 });

    const user = await prisma.user.create({
      data: {
        username,
        displayName: displayName.slice(0, 80),
        passwordHash: await bcrypt.hash(password, 10),
        isActive: true,
      },
    });
    await logOp({ userId: current.id, action: 'create_user', targetType: 'user', targetId: user.id, detail: { username } });
    return NextResponse.json({ ok: true, user: serializeUser(user) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    if ((e as { code?: string }).code === 'P2002') return NextResponse.json({ ok: false, error: '账号已存在' }, { status: 409 });
    return NextResponse.json({ ok: false, error: '新增账号失败' }, { status: 500 });
  }
}
