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

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const current = await requireUser();
    const old = await prisma.user.findUnique({ where: { id: params.id } });
    if (!old) return NextResponse.json({ ok: false, error: '账号不存在' }, { status: 404 });

    const body = await req.json().catch(() => ({})) as { displayName?: string; isActive?: boolean };
    const data: { displayName?: string; isActive?: boolean } = {};
    if (body.displayName !== undefined) data.displayName = String(body.displayName || '').trim().slice(0, 80) || old.username;
    if (body.isActive !== undefined) data.isActive = !!body.isActive;

    if (data.isActive === false && old.isActive) {
      const activeCount = await prisma.user.count({ where: { isActive: true } });
      if (activeCount <= 1) return NextResponse.json({ ok: false, error: '不能禁用最后一个可登录账号' }, { status: 400 });
    }

    const user = await prisma.user.update({ where: { id: params.id }, data });
    await logOp({
      userId: current.id,
      action: data.isActive === false ? 'disable_user' : 'update_user',
      targetType: 'user',
      targetId: user.id,
      detail: { username: user.username, fields: Object.keys(data) },
    });
    return NextResponse.json({ ok: true, user: serializeUser(user) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    return NextResponse.json({ ok: false, error: '保存账号失败' }, { status: 500 });
  }
}
