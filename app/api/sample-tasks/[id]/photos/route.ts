import crypto from 'node:crypto';
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
  sampleTaskStatusAfterCapture,
  serializeSampleTask,
} from '@/lib/sample-team';
import { deleteObjectsBestEffort, putObject } from '@/lib/s3';
import { safeFilename, validateFileContent } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function datePart(date = new Date()) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
}
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let objectKey: string | null = null;
  try {
    const user = await requireUser();
    const actor = sampleActor(user);
    const form = await req.formData();
    const upload = form.get('file');
    if (!(upload instanceof File)) return NextResponse.json({ ok: false, error: '请选择照片' }, { status: 400 });
    const categoryValue = form.get('category');
    const category = isSamplePhotoCategory(categoryValue) ? categoryValue : 'UNCLASSIFIED';
    const caption = cleanSampleText(form.get('caption'), 500);
    const captureSource = cleanSampleText(form.get('captureSource'), 30);
    const clientMutationId = cleanSampleText(form.get('clientMutationId'), 80);
    const linkedEntryId = cleanSampleText(form.get('linkedEntryId'), 80);
    const task = await prisma.sampleTask.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!task) return NextResponse.json({ ok: false, error: '样品任务不存在' }, { status: 404 });
    if (task.status === 'CANCELLED' || task.status === 'COMPLETED') {
      return NextResponse.json({ ok: false, error: '已完成或已取消任务不能继续上传，请先重新打开任务' }, { status: 409 });
    }
    if (clientMutationId) {
      const existing = await prisma.samplePhoto.findFirst({
        where: { taskId: task.id, clientMutationId, deletedAt: null },
        select: { taskId: true },
      });
      if (existing) {
        const updated = await prisma.sampleTask.findUnique({ where: { id: existing.taskId }, include: sampleTaskInclude });
        return NextResponse.json({ ok: true, task: updated ? serializeSampleTask(updated) : null });
      }
    }
    const body = Buffer.from(await upload.arrayBuffer());
    const error = validateFileContent(upload.name, upload.type, upload.size, body);
    if (error) return NextResponse.json({ ok: false, error }, { status: 400 });
    if (!upload.type.startsWith('image/')) return NextResponse.json({ ok: false, error: '样品照片仅支持图片文件' }, { status: 400 });
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    objectKey = `sample-tasks/${task.code}/${datePart()}/sha256-${sha256}-${crypto.randomUUID()}-${safeFilename(upload.name)}`;
    await putObject({
      key: objectKey,
      body,
      contentType: upload.type || 'application/octet-stream',
      originalName: upload.name,
    });
    const photoResult = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-task:${task.id}`}))`;
      const fresh = await tx.sampleTask.findFirst({ where: { id: task.id, deletedAt: null } });
      if (!fresh) throw new Error('SAMPLE_TASK_NOT_FOUND');
      if (fresh.status === 'CANCELLED' || fresh.status === 'COMPLETED') throw new Error('SAMPLE_TASK_CLOSED');
      if (clientMutationId) {
        const existing = await tx.samplePhoto.findFirst({
          where: { taskId: fresh.id, clientMutationId, deletedAt: null },
          select: { id: true },
        });
        if (existing) return { id: existing.id, duplicate: true };
      }
      if (linkedEntryId) {
        const linkedEntry = await tx.sampleDataEntry.findFirst({
          where: { id: linkedEntryId, taskId: fresh.id, deletedAt: null },
          select: { id: true },
        });
        if (!linkedEntry) throw new Error('SAMPLE_LINKED_ENTRY_NOT_FOUND');
      }
      const photo = await tx.samplePhoto.create({
        data: {
          taskId: fresh.id,
          linkedEntryId,
          clientMutationId,
          category,
          caption,
          originalName: upload.name,
          mimeType: upload.type || 'application/octet-stream',
          size: upload.size,
          objectKey: objectKey!,
          sha256,
          captureSource,
          uploadedById: actor.id,
          uploadedByName: actor.name,
        },
        select: { id: true },
      });
      await tx.sampleTask.update({
        where: { id: fresh.id },
        data: {
          status: sampleTaskStatusAfterCapture(fresh.status),
          startedAt: fresh.startedAt || new Date(),
          submittedAt: null,
          updatedById: actor.id,
          updatedByName: actor.name,
          version: { increment: 1 },
        },
      });
      await refreshSampleTaskDataStatus(tx, fresh.id);
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'upload_sample_photo',
          targetType: 'sample_photo',
          targetId: photo.id,
          detail: { taskId: fresh.id, taskCode: fresh.code, category, size: upload.size, sha256, linkedEntryId, clientMutationId },
        },
      });
      return { id: photo.id, duplicate: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (photoResult.duplicate && objectKey) await deleteObjectsBestEffort([objectKey]);
    objectKey = null;
    const photo = await prisma.samplePhoto.findUnique({ where: { id: photoResult.id }, select: { taskId: true } });
    const updated = photo
      ? await prisma.sampleTask.findUnique({ where: { id: photo.taskId }, include: sampleTaskInclude })
      : null;
    return NextResponse.json({ ok: true, task: updated ? serializeSampleTask(updated) : null }, { status: 201 });
  } catch (error) {
    if (objectKey) await deleteObjectsBestEffort([objectKey]);
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error) {
      if (error.message === 'SAMPLE_TASK_NOT_FOUND') return NextResponse.json({ ok: false, error: '样品任务不存在' }, { status: 404 });
      if (error.message === 'SAMPLE_TASK_CLOSED') return NextResponse.json({ ok: false, error: '已完成或已取消任务不能继续上传' }, { status: 409 });
      if (error.message === 'SAMPLE_LINKED_ENTRY_NOT_FOUND') return NextResponse.json({ ok: false, error: '关联的采集记录不存在，请刷新后重试' }, { status: 409 });
    }
    console.error('upload sample photo failed', error);
    return NextResponse.json({ ok: false, error: '照片上传失败，请检查对象存储' }, { status: 500 });
  }
}
