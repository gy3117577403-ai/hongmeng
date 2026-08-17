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
  sanitizeSamplePayload,
  serializeSampleTask,
} from '@/lib/sample-team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function updatedTask(taskId: string) {
  const task = await prisma.sampleTask.findUnique({ where: { id: taskId }, include: sampleTaskInclude });
  return task ? serializeSampleTask(task) : null;
}

export async function PATCH(req: NextRequest, { params }: { params: { entryId: string } }) {
  try {
    const user = await requireUser();
    const actor = sampleActor(user);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return NextResponse.json({ ok: false, error: '数据版本已失效，请刷新后重试' }, { status: 400 });
    }
    if (body.kind !== undefined && !isSampleDataKind(body.kind)) {
      return NextResponse.json({ ok: false, error: '数据类型无效' }, { status: 400 });
    }
    const payload = body.payload === undefined ? undefined : sanitizeSamplePayload(body.payload);
    const taskId = await prisma.$transaction(async tx => {
      const entry = await tx.sampleDataEntry.findFirst({ where: { id: params.entryId, deletedAt: null } });
      if (!entry) throw new Error('SAMPLE_ENTRY_NOT_FOUND');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-task:${entry.taskId}`}))`;
      const task = await tx.sampleTask.findFirst({ where: { id: entry.taskId, deletedAt: null } });
      if (!task) throw new Error('SAMPLE_TASK_NOT_FOUND');
      if (task.status === 'CANCELLED' || task.status === 'COMPLETED') throw new Error('SAMPLE_TASK_CLOSED');
      if (entry.version !== expectedVersion) throw new Error('SAMPLE_ENTRY_CONFLICT');
      if (entry.reviewStatus === 'PUBLISHED' || entry.publishedEntityId) throw new Error('SAMPLE_ENTRY_PUBLISHED');
      const updated = await tx.sampleDataEntry.updateMany({
        where: { id: entry.id, version: expectedVersion, deletedAt: null },
        data: {
          kind: isSampleDataKind(body.kind) ? body.kind : entry.kind,
          label: body.label === undefined ? entry.label : cleanSampleText(body.label, 200),
          ...(payload === undefined ? {} : { payload }),
          reviewStatus: 'DRAFT',
          publishMode: null,
          reviewComment: null,
          reviewedById: null,
          reviewedByName: null,
          reviewedAt: null,
          updatedById: actor.id,
          updatedByName: actor.name,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new Error('SAMPLE_ENTRY_CONFLICT');
      await tx.sampleTask.update({
        where: { id: task.id },
        data: {
          status: 'IN_PROGRESS',
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
          action: 'update_sample_data_entry',
          targetType: 'sample_data_entry',
          targetId: entry.id,
          detail: { taskId: task.id, kind: body.kind || entry.kind, expectedVersion },
        },
      });
      return task.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true, task: await updatedTask(taskId) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error) {
      if (error.message === 'SAMPLE_ENTRY_NOT_FOUND') return NextResponse.json({ ok: false, error: '样品数据不存在' }, { status: 404 });
      if (error.message === 'SAMPLE_TASK_NOT_FOUND') return NextResponse.json({ ok: false, error: '样品任务不存在' }, { status: 404 });
      if (error.message === 'SAMPLE_TASK_CLOSED') return NextResponse.json({ ok: false, error: '已完成或已取消任务不能修改数据' }, { status: 409 });
      if (error.message === 'SAMPLE_ENTRY_CONFLICT') return NextResponse.json({ ok: false, error: '该数据已被其他人修改，请刷新后重试' }, { status: 409 });
      if (error.message === 'SAMPLE_ENTRY_PUBLISHED') return NextResponse.json({ ok: false, error: '已发布数据不能覆盖，请新增一条修订记录' }, { status: 409 });
      if (error.message === 'SAMPLE_PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, error: '单条样品数据过大，请拆分记录' }, { status: 413 });
    }
    console.error('update sample entry failed', error);
    return NextResponse.json({ ok: false, error: '样品数据保存失败' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { entryId: string } }) {
  try {
    const user = await requireUser();
    const actor = sampleActor(user);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return NextResponse.json({ ok: false, error: '数据版本已失效，请刷新后重试' }, { status: 400 });
    }
    const taskId = await prisma.$transaction(async tx => {
      const entry = await tx.sampleDataEntry.findFirst({ where: { id: params.entryId, deletedAt: null } });
      if (!entry) throw new Error('SAMPLE_ENTRY_NOT_FOUND');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-task:${entry.taskId}`}))`;
      const task = await tx.sampleTask.findFirst({ where: { id: entry.taskId, deletedAt: null } });
      if (!task) throw new Error('SAMPLE_TASK_NOT_FOUND');
      if (task.status === 'CANCELLED' || task.status === 'COMPLETED') throw new Error('SAMPLE_TASK_CLOSED');
      if (entry.version !== expectedVersion) throw new Error('SAMPLE_ENTRY_CONFLICT');
      if (entry.reviewStatus === 'PUBLISHED' || entry.publishedEntityId) throw new Error('SAMPLE_ENTRY_PUBLISHED');
      const updated = await tx.sampleDataEntry.updateMany({
        where: { id: entry.id, version: expectedVersion, deletedAt: null },
        data: { deletedAt: new Date(), updatedById: actor.id, updatedByName: actor.name, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new Error('SAMPLE_ENTRY_CONFLICT');
      await tx.sampleTask.update({
        where: { id: entry.taskId },
        data: {
          status: 'IN_PROGRESS',
          submittedAt: null,
          updatedById: actor.id,
          updatedByName: actor.name,
          version: { increment: 1 },
        },
      });
      await refreshSampleTaskDataStatus(tx, entry.taskId);
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'delete_sample_data_entry',
          targetType: 'sample_data_entry',
          targetId: entry.id,
          detail: { taskId: entry.taskId, softDelete: true },
        },
      });
      return entry.taskId;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true, task: await updatedTask(taskId) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error) {
      if (error.message === 'SAMPLE_ENTRY_NOT_FOUND') return NextResponse.json({ ok: false, error: '样品数据不存在' }, { status: 404 });
      if (error.message === 'SAMPLE_TASK_NOT_FOUND') return NextResponse.json({ ok: false, error: '样品任务不存在' }, { status: 404 });
      if (error.message === 'SAMPLE_TASK_CLOSED') return NextResponse.json({ ok: false, error: '已完成或已取消任务不能删除数据' }, { status: 409 });
      if (error.message === 'SAMPLE_ENTRY_CONFLICT') return NextResponse.json({ ok: false, error: '该数据已被其他人修改，请刷新后重试' }, { status: 409 });
      if (error.message === 'SAMPLE_ENTRY_PUBLISHED') return NextResponse.json({ ok: false, error: '已发布数据不能删除，请新增修订记录' }, { status: 409 });
    }
    console.error('delete sample entry failed', error);
    return NextResponse.json({ ok: false, error: '样品数据删除失败' }, { status: 500 });
  }
}
