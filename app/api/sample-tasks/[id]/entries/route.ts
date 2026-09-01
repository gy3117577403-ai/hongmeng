import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  cleanSampleText,
  isSampleDataKind,
  refreshSampleTaskDataStatus,
  sampleActor,
  sampleTaskInclude,
  sampleTaskStatusAfterCapture,
  sanitizeSamplePayload,
  serializeSampleTask,
} from '@/lib/sample-team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const actor = sampleActor(user);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (!isSampleDataKind(body.kind)) return NextResponse.json({ ok: false, error: '请选择数据类型' }, { status: 400 });
    const kind = body.kind;
    const payload = sanitizeSamplePayload(body.payload);
    const clientMutationId = cleanSampleText(body.clientMutationId, 80);
    const entryId = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-task:${params.id}`}))`;
      const task = await tx.sampleTask.findFirst({ where: { id: params.id, deletedAt: null } });
      if (!task) throw new Error('SAMPLE_TASK_NOT_FOUND');
      if (task.status === 'CANCELLED' || task.status === 'COMPLETED') throw new Error('SAMPLE_TASK_CLOSED');
      if (clientMutationId) {
        const existing = await tx.sampleDataEntry.findFirst({
          where: { taskId: task.id, clientMutationId, deletedAt: null },
          select: { id: true },
        });
        if (existing) return existing.id;
      }
      const entry = await tx.sampleDataEntry.create({
        data: {
          taskId: task.id,
          kind,
          label: cleanSampleText(body.label, 200),
          payload,
          clientMutationId,
          createdById: actor.id,
          createdByName: actor.name,
          updatedById: actor.id,
          updatedByName: actor.name,
        },
        select: { id: true },
      });
      await tx.sampleTask.update({
        where: { id: task.id },
        data: {
          status: sampleTaskStatusAfterCapture(task.status),
          startedAt: task.startedAt || new Date(),
          submittedAt: null,
          updatedById: actor.id,
          updatedByName: actor.name,
          version: { increment: 1 },
        },
      });
      await refreshSampleTaskDataStatus(tx, task.id);
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'create_sample_data_entry',
          targetType: 'sample_data_entry',
          targetId: entry.id,
          detail: { taskId: task.id, taskCode: task.code, kind, clientMutationId },
        },
      });
      return entry.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const entry = await prisma.sampleDataEntry.findUnique({ where: { id: entryId }, select: { taskId: true } });
    const task = entry
      ? await prisma.sampleTask.findUnique({ where: { id: entry.taskId }, include: sampleTaskInclude })
      : null;
    return NextResponse.json({ ok: true, task: task ? serializeSampleTask(task) : null }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error) {
      if (error.message === 'SAMPLE_TASK_NOT_FOUND') return NextResponse.json({ ok: false, error: '样品任务不存在' }, { status: 404 });
      if (error.message === 'SAMPLE_TASK_CLOSED') return NextResponse.json({ ok: false, error: '已完成或已取消任务不能继续采集，请先重新打开任务' }, { status: 409 });
      if (error.message === 'SAMPLE_PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, error: '单条样品数据过大，请拆分记录' }, { status: 413 });
    }
    console.error('create sample entry failed', error);
    return NextResponse.json({ ok: false, error: '样品数据保存失败' }, { status: 500 });
  }
}
