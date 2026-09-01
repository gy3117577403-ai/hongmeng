import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  cleanSampleText,
  refreshSampleTaskDataStatus,
  sampleActor,
  sampleTaskInclude,
  serializeSampleTask,
} from '@/lib/sample-team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const actor = sampleActor(user);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const expectedVersion = Number(body.expectedVersion);
    const clientMutationId = cleanSampleText(body.clientMutationId, 80);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return NextResponse.json({ ok: false, error: '样品任务版本已失效，请刷新后重试' }, { status: 400 });
    }
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-task:${params.id}`}))`;
      const task = await tx.sampleTask.findFirst({ where: { id: params.id, deletedAt: null } });
      if (!task) throw new Error('SAMPLE_TASK_NOT_FOUND');
      if (clientMutationId && task.lastSubmissionMutationId === clientMutationId) return;
      if (task.version !== expectedVersion) throw new Error('SAMPLE_TASK_CONFLICT');
      if (task.status === 'CANCELLED' || task.status === 'COMPLETED') throw new Error('SAMPLE_TASK_CLOSED');
      const [entries, photos] = await Promise.all([
        tx.sampleDataEntry.updateMany({
          where: { taskId: task.id, deletedAt: null, reviewStatus: { in: ['DRAFT', 'CHANGES_REQUESTED'] } },
          data: { reviewStatus: 'PENDING', reviewComment: null, version: { increment: 1 } },
        }),
        tx.samplePhoto.updateMany({
          where: { taskId: task.id, deletedAt: null, reviewStatus: { in: ['DRAFT', 'CHANGES_REQUESTED'] } },
          data: { reviewStatus: 'PENDING', reviewComment: null, version: { increment: 1 } },
        }),
      ]);
      const updated = await tx.sampleTask.updateMany({
        where: { id: task.id, version: expectedVersion },
        data: {
          status: 'SUBMITTED',
          submittedAt: new Date(),
          updatedById: actor.id,
          updatedByName: actor.name,
          lastSubmissionMutationId: clientMutationId,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new Error('SAMPLE_TASK_CONFLICT');
      await refreshSampleTaskDataStatus(tx, task.id);
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'submit_sample_task_data',
          targetType: 'sample_task',
          targetId: task.id,
          detail: {
            taskCode: task.code,
            submittedEntries: entries.count,
            submittedPhotos: photos.count,
            emptySubmission: entries.count + photos.count === 0,
            clientMutationId,
          },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const task = await prisma.sampleTask.findUnique({ where: { id: params.id }, include: sampleTaskInclude });
    return NextResponse.json({ ok: true, task: task ? serializeSampleTask(task) : null });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error) {
      if (error.message === 'SAMPLE_TASK_NOT_FOUND') return NextResponse.json({ ok: false, error: '样品任务不存在' }, { status: 404 });
      if (error.message === 'SAMPLE_TASK_CONFLICT') return NextResponse.json({ ok: false, error: '样品任务已被其他人修改，请刷新后重试' }, { status: 409 });
      if (error.message === 'SAMPLE_TASK_CLOSED') return NextResponse.json({ ok: false, error: '已完成或已取消任务不能提交审核' }, { status: 409 });
    }
    console.error('submit sample task failed', error);
    return NextResponse.json({ ok: false, error: '样品任务提交失败' }, { status: 500 });
  }
}
