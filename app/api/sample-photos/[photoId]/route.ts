import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  cleanSampleText,
  isSamplePhotoCategory,
  refreshSampleTaskDataStatus,
  sampleActor,
  sampleTaskInclude,
  serializeSampleTask,
} from '@/lib/sample-team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function loadTask(taskId: string) {
  const task = await prisma.sampleTask.findUnique({ where: { id: taskId }, include: sampleTaskInclude });
  return task ? serializeSampleTask(task) : null;
}

export async function PATCH(req: NextRequest, { params }: { params: { photoId: string } }) {
  try {
    const user = await requireUser();
    const actor = sampleActor(user);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const expectedVersion = Number(body.expectedVersion);
    const expectedTaskVersion = Number(body.expectedTaskVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1 || !Number.isInteger(expectedTaskVersion) || expectedTaskVersion < 1) {
      return NextResponse.json({ ok: false, error: '照片版本已失效，请刷新后重试' }, { status: 400 });
    }
    if (body.category !== undefined && !isSamplePhotoCategory(body.category)) {
      return NextResponse.json({ ok: false, error: '照片分类无效' }, { status: 400 });
    }
    const taskId = await prisma.$transaction(async tx => {
      const photo = await tx.samplePhoto.findFirst({ where: { id: params.photoId, deletedAt: null } });
      if (!photo) throw new Error('SAMPLE_PHOTO_NOT_FOUND');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-task:${photo.taskId}`}))`;
      const task = await tx.sampleTask.findFirst({ where: { id: photo.taskId, deletedAt: null } });
      if (!task) throw new Error('SAMPLE_TASK_NOT_FOUND');
      if (task.version !== expectedTaskVersion) throw new Error('SAMPLE_TASK_CONFLICT');
      if (task.status === 'CANCELLED' || task.status === 'COMPLETED') throw new Error('SAMPLE_TASK_CLOSED');
      if (task.status === 'SUBMITTED' || task.activeSubmissionId || photo.reviewStatus === 'PENDING') throw new Error('SAMPLE_TASK_SUBMITTED');
      if (photo.version !== expectedVersion) throw new Error('SAMPLE_PHOTO_CONFLICT');
      if (photo.reviewStatus === 'PUBLISHED' || photo.publishedFileId) throw new Error('SAMPLE_PHOTO_PUBLISHED');
      const linkedEntryId = body.linkedEntryId === undefined ? photo.linkedEntryId : cleanSampleText(body.linkedEntryId, 80);
      if (linkedEntryId) {
        const linkedEntry = await tx.sampleDataEntry.findFirst({ where: { id: linkedEntryId, taskId: task.id, deletedAt: null }, select: { id: true } });
        if (!linkedEntry) throw new Error('SAMPLE_LINKED_ENTRY_NOT_FOUND');
      }
      const sortOrder = body.sortOrder === undefined ? photo.sortOrder : Number(body.sortOrder);
      if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10_000) throw new Error('SAMPLE_PHOTO_SORT_INVALID');
      const updated = await tx.samplePhoto.updateMany({
        where: { id: photo.id, version: expectedVersion, deletedAt: null },
        data: {
          category: isSamplePhotoCategory(body.category) ? body.category : photo.category,
          caption: body.caption === undefined ? photo.caption : cleanSampleText(body.caption, 500),
          captureSource: body.captureSource === undefined ? photo.captureSource : cleanSampleText(body.captureSource, 30),
          linkedEntryId,
          sortOrder,
          reviewStatus: 'DRAFT',
          reviewComment: null,
          reviewedById: null,
          reviewedByName: null,
          reviewedAt: null,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new Error('SAMPLE_PHOTO_CONFLICT');
      const taskUpdated = await tx.sampleTask.updateMany({
        where: { id: task.id, version: expectedTaskVersion },
        data: {
          status: 'IN_PROGRESS',
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
          action: 'update_sample_photo',
          targetType: 'sample_photo',
          targetId: photo.id,
          detail: { taskId: task.id, category: body.category || photo.category, expectedVersion, expectedTaskVersion, linkedEntryId, sortOrder },
        },
      });
      return task.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true, task: await loadTask(taskId) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error) {
      if (error.message === 'SAMPLE_PHOTO_NOT_FOUND') return NextResponse.json({ ok: false, error: '照片不存在' }, { status: 404 });
      if (error.message === 'SAMPLE_TASK_NOT_FOUND') return NextResponse.json({ ok: false, error: '样品任务不存在' }, { status: 404 });
      if (error.message === 'SAMPLE_TASK_CONFLICT') return NextResponse.json({ ok: false, error: '样品任务已被其他人修改，请刷新后重试' }, { status: 409 });
      if (error.message === 'SAMPLE_TASK_CLOSED') return NextResponse.json({ ok: false, error: '已完成或已取消任务不能修改照片' }, { status: 409 });
      if (error.message === 'SAMPLE_TASK_SUBMITTED') return NextResponse.json({ ok: false, error: '样品数据已经提交，请先撤回提交再修改照片' }, { status: 409 });
      if (error.message === 'SAMPLE_LINKED_ENTRY_NOT_FOUND') return NextResponse.json({ ok: false, error: '关联的采集记录不存在，请刷新后重试' }, { status: 409 });
      if (error.message === 'SAMPLE_PHOTO_SORT_INVALID') return NextResponse.json({ ok: false, error: '照片排序值无效' }, { status: 400 });
      if (error.message === 'SAMPLE_PHOTO_CONFLICT') return NextResponse.json({ ok: false, error: '照片已被其他人修改，请刷新后重试' }, { status: 409 });
      if (error.message === 'SAMPLE_PHOTO_PUBLISHED') return NextResponse.json({ ok: false, error: '已发布照片不能覆盖，请上传新版本' }, { status: 409 });
    }
    console.error('update sample photo failed', error);
    return NextResponse.json({ ok: false, error: '照片信息保存失败' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { photoId: string } }) {
  try {
    const user = await requireUser();
    const actor = sampleActor(user);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const expectedVersion = Number(body.expectedVersion);
    const expectedTaskVersion = Number(body.expectedTaskVersion);
    const deleteReason = cleanSampleText(body.deleteReason, 500);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1 || !Number.isInteger(expectedTaskVersion) || expectedTaskVersion < 1) {
      return NextResponse.json({ ok: false, error: '照片版本已失效，请刷新后重试' }, { status: 400 });
    }
    const taskId = await prisma.$transaction(async tx => {
      const photo = await tx.samplePhoto.findFirst({ where: { id: params.photoId, deletedAt: null } });
      if (!photo) throw new Error('SAMPLE_PHOTO_NOT_FOUND');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-task:${photo.taskId}`}))`;
      const task = await tx.sampleTask.findFirst({ where: { id: photo.taskId, deletedAt: null } });
      if (!task) throw new Error('SAMPLE_TASK_NOT_FOUND');
      if (task.version !== expectedTaskVersion) throw new Error('SAMPLE_TASK_CONFLICT');
      if (task.status === 'CANCELLED' || task.status === 'COMPLETED') throw new Error('SAMPLE_TASK_CLOSED');
      if (task.status === 'SUBMITTED' || task.activeSubmissionId || photo.reviewStatus === 'PENDING') throw new Error('SAMPLE_TASK_SUBMITTED');
      if (photo.version !== expectedVersion) throw new Error('SAMPLE_PHOTO_CONFLICT');
      if (photo.reviewStatus === 'PUBLISHED' || photo.publishedFileId) throw new Error('SAMPLE_PHOTO_PUBLISHED');
      const updated = await tx.samplePhoto.updateMany({
        where: { id: photo.id, version: expectedVersion, deletedAt: null },
        data: {
          deletedAt: new Date(),
          deletedById: actor.id,
          deletedByName: actor.name,
          deleteReason,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new Error('SAMPLE_PHOTO_CONFLICT');
      const taskUpdated = await tx.sampleTask.updateMany({
        where: { id: photo.taskId, version: expectedTaskVersion },
        data: {
          status: 'IN_PROGRESS',
          submittedAt: null,
          updatedById: actor.id,
          updatedByName: actor.name,
          version: { increment: 1 },
        },
      });
      if (taskUpdated.count !== 1) throw new Error('SAMPLE_TASK_CONFLICT');
      await refreshSampleTaskDataStatus(tx, photo.taskId);
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'delete_sample_photo',
          targetType: 'sample_photo',
          targetId: photo.id,
          detail: { taskId: photo.taskId, softDelete: true, objectRetained: true, deleteReason },
        },
      });
      return photo.taskId;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true, task: await loadTask(taskId) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error) {
      if (error.message === 'SAMPLE_PHOTO_NOT_FOUND') return NextResponse.json({ ok: false, error: '照片不存在' }, { status: 404 });
      if (error.message === 'SAMPLE_TASK_NOT_FOUND') return NextResponse.json({ ok: false, error: '样品任务不存在' }, { status: 404 });
      if (error.message === 'SAMPLE_TASK_CONFLICT') return NextResponse.json({ ok: false, error: '样品任务已被其他人修改，请刷新后重试' }, { status: 409 });
      if (error.message === 'SAMPLE_TASK_CLOSED') return NextResponse.json({ ok: false, error: '已完成或已取消任务不能删除照片' }, { status: 409 });
      if (error.message === 'SAMPLE_TASK_SUBMITTED') return NextResponse.json({ ok: false, error: '待审核照片不能直接删除，请先撤回提交' }, { status: 409 });
      if (error.message === 'SAMPLE_PHOTO_CONFLICT') return NextResponse.json({ ok: false, error: '照片已被其他人修改，请刷新后重试' }, { status: 409 });
      if (error.message === 'SAMPLE_PHOTO_PUBLISHED') return NextResponse.json({ ok: false, error: '已发布照片不能删除，请上传新版本' }, { status: 409 });
    }
    console.error('delete sample photo failed', error);
    return NextResponse.json({ ok: false, error: '照片删除失败' }, { status: 500 });
  }
}
