import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { changeDetailInclude, serializeChange } from '@/lib/changes';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const current = await prisma.changeRequest.findFirst({ where: { id: params.id, deletedAt: null }, select: { id: true } });
    if (!current) return NextResponse.json({ ok: false, error: '变更不存在或已删除' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const content = typeof body.content === 'string' ? body.content.trim().slice(0, 2000) : '';
    if (!content) return NextResponse.json({ ok: false, error: '记录内容不能为空' }, { status: 400 });
    const change = await prisma.$transaction(async tx => {
      await tx.changeActivity.create({ data: { changeRequestId: current.id, action: 'comment', content, actorId: user.id } });
      await tx.changeRequest.update({ where: { id: current.id }, data: { updatedAt: new Date() } });
      return tx.changeRequest.findUniqueOrThrow({ where: { id: current.id }, include: changeDetailInclude });
    });
    await logOp({ userId: user.id, action: 'comment_change_request', targetType: 'change_request', targetId: current.id });
    return NextResponse.json({ ok: true, change: serializeChange(change) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('change comment failed', error);
    return NextResponse.json({ ok: false, error: '变更记录添加失败' }, { status: 500 });
  }
}
