import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  cleanSampleText,
  isSampleDataKind,
  refreshSampleTaskDataStatus,
  sampleActor,
  sampleRequestHash,
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
    const expectedTaskVersion = Number(body.expectedTaskVersion);
    if (!Number.isInteger(expectedTaskVersion) || expectedTaskVersion < 1) {
      return NextResponse.json({ ok: false, error: '样品任务版本已失效，请刷新后重试' }, { status: 400 });
    }
    if (!isSampleDataKind(body.kind)) return NextResponse.json({ ok: false, error: '请选择数据类型' }, { status: 400 });
    const kind = body.kind;
    const payload = sanitizeSamplePayload(body.payload);
    const clientMutationId = cleanSampleText(body.clientMutationId, 80);
    const label = cleanSampleText(body.label, 200);
    if (!clientMutationId) return NextResponse.json({ ok: false, error: '缺少数据保存编号，请重新保存' }, { status: 400 });
    const requestHash = sampleRequestHash({ kind, label, payload });
    const entryResult = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-task:${params.id}`}))`;
      const task = await tx.sampleTask.findFirst({ where: { id: params.id, deletedAt: null } });
      if (!task) throw new Error('SAMPLE_TASK_NOT_FOUND');
      if (task.status === 'CANCELLED' || task.status === 'COMPLETED') throw new Error('SAMPLE_TASK_CLOSED');
      const replay = await tx.sampleDataEntry.findUnique({
        where: { taskId_clientMutationId: { taskId: task.id, clientMutationId } },
        select: { id: true, kind: true, label: true, payload: true, requestHash: true, deletedAt: true },
      });
      if (replay) {
        const replayHash = replay.requestHash || sampleRequestHash({ kind: replay.kind, label: replay.label, payload: replay.payload });
        if (replayHash !== requestHash) throw new Error('SAMPLE_ENTRY_MUTATION_CONFLICT');
        if (replay.deletedAt) throw new Error('SAMPLE_ENTRY_MUTATION_TOMBSTONED');
        return { id: replay.id, deduplicated: true };
      }
      if (task.version !== expectedTaskVersion) throw new Error('SAMPLE_TASK_CONFLICT');
      if (task.status === 'SUBMITTED' || task.activeSubmissionId) throw new Error('SAMPLE_TASK_SUBMITTED');
      const duplicate = await tx.sampleDataEntry.findFirst({
        where: { taskId: task.id, requestHash, deletedAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      if (duplicate) return { id: duplicate.id, deduplicated: true };
      const entry = await tx.sampleDataEntry.create({
        data: {
          taskId: task.id,
          kind,
          label,
          payload,
          clientMutationId,
          requestHash,
          createdById: actor.id,
          createdByName: actor.name,
          updatedById: actor.id,
          updatedByName: actor.name,
        },
        select: { id: true },
      });
      const taskUpdated = await tx.sampleTask.updateMany({
        where: { id: task.id, version: expectedTaskVersion },
        data: {
          status: sampleTaskStatusAfterCapture(task.status),
          startedAt: task.startedAt || new Date(),
          submittedAt: null,
          updatedById: actor.id,
          updatedByName: actor.name,
          version: { increment: 1 },
        },
      });
      if (taskUpdated.count !== 1) throw new Error('SAMPLE_TASK_CONFLICT');
      await refreshSampleTaskDataStatus(tx, task.id);
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'create_sample_data_entry',
          targetType: 'sample_data_entry',
          targetId: entry.id,
          detail: { taskId: task.id, taskCode: task.code, kind, clientMutationId, requestHash },
        },
      });
      return { id: entry.id, deduplicated: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const entry = await prisma.sampleDataEntry.findUnique({ where: { id: entryResult.id }, select: { taskId: true } });
    const task = entry
      ? await prisma.sampleTask.findUnique({ where: { id: entry.taskId }, include: sampleTaskInclude })
      : null;
    return NextResponse.json({ ok: true, task: task ? serializeSampleTask(task) : null, deduplicated: entryResult.deduplicated }, { status: entryResult.deduplicated ? 200 : 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error) {
      if (error.message === 'SAMPLE_TASK_NOT_FOUND') return NextResponse.json({ ok: false, error: '样品任务不存在' }, { status: 404 });
      if (error.message === 'SAMPLE_TASK_CONFLICT') return NextResponse.json({ ok: false, error: '样品任务已被其他人修改，请刷新后重试' }, { status: 409 });
      if (error.message === 'SAMPLE_TASK_CLOSED') return NextResponse.json({ ok: false, error: '已完成或已取消任务仅支持查看历史，不能新增数据' }, { status: 409 });
      if (error.message === 'SAMPLE_TASK_SUBMITTED') return NextResponse.json({ ok: false, error: '样品数据已经提交，请先撤回提交再编辑' }, { status: 409 });
      if (error.message === 'SAMPLE_ENTRY_MUTATION_CONFLICT') return NextResponse.json({ ok: false, error: '同一数据保存编号对应了不同内容，请重新保存' }, { status: 409 });
      if (error.message === 'SAMPLE_ENTRY_MUTATION_TOMBSTONED') return NextResponse.json({ ok: false, error: '该数据保存记录已经删除，请使用新的保存编号' }, { status: 409 });
      if (error.message === 'SAMPLE_PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, error: '单条样品数据过大，请拆分记录' }, { status: 413 });
    }
    console.error('create sample entry failed', error);
    return NextResponse.json({ ok: false, error: '样品数据保存失败' }, { status: 500 });
  }
}
