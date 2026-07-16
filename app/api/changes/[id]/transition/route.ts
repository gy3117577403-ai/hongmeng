import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { CHANGE_STATUSES, changeDetailInclude, changeSnapshot, serializeChange, transitionChangeData } from '@/lib/changes';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import type { ChangeStatus } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const current = await prisma.changeRequest.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!current) return NextResponse.json({ ok: false, error: '变更不存在或已删除' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion !== current.version) {
      return NextResponse.json({ ok: false, error: '变更已被其他操作更新，请刷新后重试' }, { status: 409 });
    }
    const target = typeof body.status === 'string' ? body.status as ChangeStatus : null;
    if (!target || !CHANGE_STATUSES.includes(target)) return NextResponse.json({ ok: false, error: '目标状态不正确' }, { status: 400 });
    const transition = transitionChangeData(current, target, body);
    if (transition.error) return NextResponse.json({ ok: false, error: transition.error }, { status: 409 });
    if (target === 'implementing' && !current.ownerId) transition.data.ownerId = user.id;
    const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 2000) : '';

    const change = await prisma.$transaction(async tx => {
      const updated = await tx.changeRequest.updateMany({ where: { id: current.id, version: current.version, status: current.status, deletedAt: null }, data: transition.data });
      if (updated.count !== 1) return null;
      const changed = await tx.changeRequest.findUniqueOrThrow({ where: { id: current.id } });
      await tx.changeActivity.create({ data: { changeRequestId: current.id, action: 'transition', content: comment || null, fromStatus: current.status, toStatus: target, actorId: user.id } });
      await tx.dataChangeSnapshot.create({ data: { entityType: 'change_request', entityId: current.id, action: 'transition_change_request', beforeJson: changeSnapshot(current), afterJson: changeSnapshot(changed), changedBy: user.displayName || user.username } });
      return tx.changeRequest.findUniqueOrThrow({ where: { id: current.id }, include: changeDetailInclude });
    });
    if (!change) return NextResponse.json({ ok: false, error: '变更状态已发生变化，请刷新后重试' }, { status: 409 });
    await logOp({ userId: user.id, action: 'transition_change_request', targetType: 'change_request', targetId: current.id, detail: { fromStatus: current.status, toStatus: target } });
    return NextResponse.json({ ok: true, change: serializeChange(change) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('change transition failed', error);
    return NextResponse.json({ ok: false, error: '变更状态流转失败' }, { status: 500 });
  }
}
