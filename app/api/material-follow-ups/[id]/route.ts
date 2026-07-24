import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import {
  materialFollowUpDetailInclude,
  prepareMaterialFollowUpTransition,
  serializeMaterialFollowUpTask,
  type MaterialFollowUpTransitionInput,
} from '@/lib/material-follow-up';
import { prisma } from '@/lib/prisma';
import type { MaterialFollowUpStatusDTO } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const task = await prisma.materialFollowUpTask.findUnique({
      where: { id: params.id },
      include: materialFollowUpDetailInclude,
    });
    if (!task) return NextResponse.json({ ok: false, error: '缺料跟进任务不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, task: serializeMaterialFollowUpTask(task) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('material follow-up detail failed', error);
    return NextResponse.json({ ok: false, error: '缺料跟进详情加载失败' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser({ write: 'production' });
    const body = await req.json().catch(() => ({})) as MaterialFollowUpTransitionInput & { version?: unknown };
    const current = await prisma.materialFollowUpTask.findUnique({ where: { id: params.id } });
    if (!current) return NextResponse.json({ ok: false, error: '缺料跟进任务不存在' }, { status: 404 });
    const version = Number(body.version);
    if (!Number.isInteger(version) || version < 0) {
      return NextResponse.json({ ok: false, error: '缺少有效的任务版本，请刷新后重试' }, { status: 400 });
    }
    const transition = prepareMaterialFollowUpTransition({
      status: current.status as MaterialFollowUpStatusDTO,
      ownerId: current.ownerId,
      expectedAt: current.expectedAt,
    }, body, user.id);
    if (!transition.ok) {
      return NextResponse.json({ ok: false, error: transition.error }, { status: transition.statusCode });
    }
    const owner = await prisma.user.findFirst({
      where: { id: transition.next.ownerId, isActive: true },
      select: { id: true },
    });
    if (!owner) return NextResponse.json({ ok: false, error: '请选择有效的在用账号作为负责人' }, { status: 400 });

    const task = await prisma.$transaction(async tx => {
      const update = await tx.materialFollowUpTask.updateMany({
        where: { id: current.id, version },
        data: {
          ...transition.next,
          version: { increment: 1 },
        },
      });
      if (update.count !== 1) throw new Error('MATERIAL_FOLLOW_UP_VERSION_CONFLICT');
      await tx.materialFollowUpActivity.create({
        data: {
          taskId: current.id,
          action: transition.action,
          fromStatus: current.status,
          toStatus: transition.next.status,
          content: transition.content,
          actorId: user.id,
        },
      });
      return tx.materialFollowUpTask.findUniqueOrThrow({
        where: { id: current.id },
        include: materialFollowUpDetailInclude,
      });
    });
    await logOp({
      userId: user.id,
      action: `material_follow_up_${transition.action}`,
      targetType: 'material_follow_up_task',
      targetId: task.id,
      detail: {
        warehouseTaskId: task.warehouseTaskId,
        fromStatus: current.status,
        toStatus: transition.next.status,
        ownerId: transition.next.ownerId,
      },
    });
    return NextResponse.json({ ok: true, task: serializeMaterialFollowUpTask(task) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error && error.message === 'MATERIAL_FOLLOW_UP_VERSION_CONFLICT') {
      return NextResponse.json({ ok: false, error: '任务已被其他账号更新，请刷新后重试' }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ ok: false, error: '缺料跟进任务不存在' }, { status: 404 });
    }
    console.error('material follow-up update failed', error);
    return NextResponse.json({ ok: false, error: '缺料跟进更新失败' }, { status: 500 });
  }
}
