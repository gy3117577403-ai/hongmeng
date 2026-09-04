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
  sampleRequestHash,
  sampleTaskInclude,
  sampleTaskStatusAfterCapture,
  serializeSampleTask,
} from '@/lib/sample-team';
import { deleteObjectsBestEffort, putObject } from '@/lib/s3';
import { safeFilename, validateFileContent } from '@/lib/validation';
import { inspectMediaImage } from '@/lib/media-assets';
import { withSamplePhotoSerializableRetry } from './serializable-retry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RAW_PHOTO_PROTOCOL = 'raw-v1';
const RAW_PHOTO_METADATA_LIMIT = 8 * 1024;

type ParsedSamplePhotoUpload = {
  upload: { name: string; type: string; size: number };
  body: Buffer;
  fields: Record<string, unknown>;
  protocol: 'multipart' | typeof RAW_PHOTO_PROTOCOL;
};

class SamplePhotoRequestError extends Error {
  constructor(
    readonly code: string,
    readonly publicMessage: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(publicMessage);
    this.name = 'SamplePhotoRequestError';
  }
}

function rawPhotoExtension(mimeType: string): string | null {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return null;
}

function decodeRawPhotoMetadata(encoded: string | null): Record<string, unknown> {
  if (!encoded || encoded.length > RAW_PHOTO_METADATA_LIMIT || !/^[a-z0-9_-]+$/i.test(encoded)) {
    throw new SamplePhotoRequestError('SAMPLE_PHOTO_METADATA_INVALID', '照片上传信息无效，请保留照片后重试', 400);
  }
  try {
    const decoded = Buffer.from(encoded, 'base64url');
    if (!decoded.length || decoded.length > RAW_PHOTO_METADATA_LIMIT) throw new Error('metadata size invalid');
    const metadata: unknown = JSON.parse(decoded.toString('utf8'));
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('metadata object invalid');
    return metadata as Record<string, unknown>;
  } catch (error) {
    throw new SamplePhotoRequestError('SAMPLE_PHOTO_METADATA_INVALID', '照片上传信息无效，请保留照片后重试', 400, error);
  }
}

async function parseSamplePhotoUpload(req: NextRequest): Promise<ParsedSamplePhotoUpload> {
  const protocol = req.headers.get('x-sample-photo-protocol');
  if (protocol === RAW_PHOTO_PROTOCOL) {
    const fields = decodeRawPhotoMetadata(req.headers.get('x-sample-photo-metadata'));
    const mimeType = (req.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
    const extension = rawPhotoExtension(mimeType);
    if (!extension) {
      throw new SamplePhotoRequestError('SAMPLE_PHOTO_CONTENT_TYPE_INVALID', '样品照片仅支持 JPG、PNG、WEBP 图片', 400);
    }
    let body: Buffer;
    try {
      body = Buffer.from(await req.arrayBuffer());
    } catch (error) {
      throw new SamplePhotoRequestError('SAMPLE_PHOTO_BODY_READ_FAILED', '照片内容读取失败，请保留照片后重试', 400, error);
    }
    const mutationId = cleanSampleText(fields.clientMutationId, 80);
    const stableId = mutationId?.replace(/[^a-z0-9_-]/gi, '').slice(0, 64) || crypto.randomUUID();
    return {
      upload: { name: `sample-${stableId}.${extension}`, type: mimeType, size: body.length },
      body,
      fields,
      protocol: RAW_PHOTO_PROTOCOL,
    };
  }
  if (protocol) {
    throw new SamplePhotoRequestError('SAMPLE_PHOTO_PROTOCOL_UNSUPPORTED', '照片上传协议不受支持，请刷新页面后重试', 400);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (error) {
    throw new SamplePhotoRequestError('SAMPLE_PHOTO_FORM_PARSE_FAILED', '照片上传请求解析失败，请保留照片后重试', 400, error);
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    throw new SamplePhotoRequestError('SAMPLE_PHOTO_FILE_MISSING', '请选择照片', 400);
  }
  let body: Buffer;
  try {
    body = Buffer.from(await file.arrayBuffer());
  } catch (error) {
    throw new SamplePhotoRequestError('SAMPLE_PHOTO_BODY_READ_FAILED', '照片内容读取失败，请保留照片后重试', 400, error);
  }
  return {
    upload: { name: file.name, type: file.type, size: file.size },
    body,
    fields: {
      category: form.get('category'),
      caption: form.get('caption'),
      captureSource: form.get('captureSource'),
      sourceOriginalName: form.get('sourceOriginalName'),
      sortOrder: form.get('sortOrder'),
      clientMutationId: form.get('clientMutationId'),
      expectedTaskVersion: form.get('expectedTaskVersion'),
      linkedEntryId: form.get('linkedEntryId'),
    },
    protocol: 'multipart',
  };
}

function datePart(date = new Date()) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
}
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let objectKey: string | null = null;
  let failureStage = 'authentication';
  try {
    const user = await requireUser();
    const actor = sampleActor(user);
    failureStage = 'request-parse';
    const parsedUpload = await parseSamplePhotoUpload(req);
    const { upload, body, fields } = parsedUpload;
    failureStage = 'validation';
    const categoryValue = fields.category;
    const category = isSamplePhotoCategory(categoryValue) ? categoryValue : 'UNCLASSIFIED';
    const caption = cleanSampleText(fields.caption, 500);
    const captureSource = cleanSampleText(fields.captureSource, 30);
    const clientMutationId = cleanSampleText(fields.clientMutationId, 80);
    const linkedEntryId = cleanSampleText(fields.linkedEntryId, 80);
    const sourceOriginalName = cleanSampleText(fields.sourceOriginalName, 255) || upload.name;
    const expectedTaskVersion = Number(fields.expectedTaskVersion);
    const sortOrder = Number(fields.sortOrder || 0);
    if (!Number.isInteger(expectedTaskVersion) || expectedTaskVersion < 1) {
      return NextResponse.json({ ok: false, error: '样品任务版本已失效，请刷新后重试' }, { status: 400 });
    }
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10_000) {
      return NextResponse.json({ ok: false, error: '照片排序值无效' }, { status: 400 });
    }
    if (!clientMutationId) return NextResponse.json({ ok: false, error: '缺少照片上传编号，请重新选择照片' }, { status: 400 });
    const task = await prisma.sampleTask.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!task) return NextResponse.json({ ok: false, error: '样品任务不存在' }, { status: 404 });
    if (task.status === 'CANCELLED' || task.status === 'COMPLETED') {
      return NextResponse.json({ ok: false, error: '已完成或已取消任务仅支持查看历史，不能新增照片' }, { status: 409 });
    }
    const error = validateFileContent(upload.name, upload.type, upload.size, body);
    if (error) return NextResponse.json({ ok: false, error }, { status: 400 });
    if (!upload.type.startsWith('image/')) return NextResponse.json({ ok: false, error: '样品照片仅支持图片文件' }, { status: 400 });
    const imageMetadata = await inspectMediaImage(body, upload.type).catch(() => null);
    if (!imageMetadata) return NextResponse.json({ ok: false, error: '图片像素过大、已损坏或格式不受支持' }, { status: 400 });
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    const requestHash = sampleRequestHash({ sha256, category, caption, captureSource, linkedEntryId, sortOrder, sourceOriginalName });
    const replay = await prisma.samplePhoto.findUnique({
      where: { taskId_clientMutationId: { taskId: task.id, clientMutationId } },
      select: { id: true, taskId: true, sha256: true, requestHash: true, deletedAt: true, category: true, caption: true, captureSource: true, linkedEntryId: true, sortOrder: true, sourceOriginalName: true, originalName: true },
    });
    if (replay) {
      const replayHash = replay.requestHash || sampleRequestHash({ sha256: replay.sha256, category: replay.category, caption: replay.caption, captureSource: replay.captureSource, linkedEntryId: replay.linkedEntryId, sortOrder: replay.sortOrder, sourceOriginalName: replay.sourceOriginalName || replay.originalName });
      if (replay.sha256 !== sha256 || replayHash !== requestHash) {
        return NextResponse.json({ ok: false, error: '同一照片上传编号对应了不同文件，请重新选择照片' }, { status: 409 });
      }
      if (replay.deletedAt) {
        return NextResponse.json({ ok: false, error: '该照片上传记录已经删除，请使用新的上传编号' }, { status: 409 });
      }
      const updated = await prisma.sampleTask.findUnique({ where: { id: replay.taskId }, include: sampleTaskInclude });
      return NextResponse.json({ ok: true, task: updated ? serializeSampleTask(updated) : null, photoId: replay.id, deduplicated: true });
    }
    if (expectedTaskVersion > task.version) return NextResponse.json({ ok: false, error: '样品任务版本无效，请刷新后重试' }, { status: 409 });
    if (task.status === 'SUBMITTED' || task.activeSubmissionId) {
      return NextResponse.json({ ok: false, error: '样品数据已经提交，请先撤回提交再上传照片' }, { status: 409 });
    }
    const contentDuplicate = await prisma.samplePhoto.findFirst({
      where: { taskId: task.id, sha256, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, taskId: true },
    });
    if (contentDuplicate) {
      const updated = await prisma.sampleTask.findUnique({ where: { id: contentDuplicate.taskId }, include: sampleTaskInclude });
      return NextResponse.json({ ok: true, task: updated ? serializeSampleTask(updated) : null, photoId: contentDuplicate.id, deduplicated: true });
    }
    objectKey = `sample-tasks/${task.code}/${datePart()}/sha256-${sha256}-${crypto.randomUUID()}-${safeFilename(upload.name)}`;
    failureStage = 'object-storage';
    await putObject({
      key: objectKey,
      body,
      contentType: upload.type || 'application/octet-stream',
      originalName: upload.name,
    });
    failureStage = 'database';
    const photoResult = await withSamplePhotoSerializableRetry(() => prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-task:${task.id}`}))`;
      const fresh = await tx.sampleTask.findFirst({ where: { id: task.id, deletedAt: null } });
      if (!fresh) throw new Error('SAMPLE_TASK_NOT_FOUND');
      // Photo append is commutative. Multiple files selected together share one
      // base version and are serialized by the task lock; a later append may
      // therefore observe a higher current version without becoming stale.
      if (expectedTaskVersion > fresh.version) throw new Error('SAMPLE_TASK_CONFLICT');
      if (fresh.status === 'CANCELLED' || fresh.status === 'COMPLETED') throw new Error('SAMPLE_TASK_CLOSED');
      if (fresh.status === 'SUBMITTED' || fresh.activeSubmissionId) throw new Error('SAMPLE_TASK_SUBMITTED');
      const existing = await tx.samplePhoto.findUnique({
        where: { taskId_clientMutationId: { taskId: fresh.id, clientMutationId } },
        select: { id: true, sha256: true, requestHash: true, deletedAt: true, category: true, caption: true, captureSource: true, linkedEntryId: true, sortOrder: true, sourceOriginalName: true, originalName: true },
      });
      if (existing) {
        const existingHash = existing.requestHash || sampleRequestHash({ sha256: existing.sha256, category: existing.category, caption: existing.caption, captureSource: existing.captureSource, linkedEntryId: existing.linkedEntryId, sortOrder: existing.sortOrder, sourceOriginalName: existing.sourceOriginalName || existing.originalName });
        if (existing.sha256 !== sha256 || existingHash !== requestHash) throw new Error('SAMPLE_PHOTO_MUTATION_CONFLICT');
        if (existing.deletedAt) throw new Error('SAMPLE_PHOTO_MUTATION_TOMBSTONED');
        return { id: existing.id, duplicate: true };
      }
      const duplicateContent = await tx.samplePhoto.findFirst({
        where: { taskId: fresh.id, sha256, deletedAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      if (duplicateContent) return { id: duplicateContent.id, duplicate: true };
      if (linkedEntryId) {
        const linkedEntry = await tx.sampleDataEntry.findFirst({
          where: { id: linkedEntryId, taskId: fresh.id, deletedAt: null },
          select: { id: true },
        });
        if (!linkedEntry) throw new Error('SAMPLE_LINKED_ENTRY_NOT_FOUND');
      }
      const mediaAsset = await tx.mediaAsset.create({
        data: {
          originalObjectKey: objectKey!,
          sha256,
          mimeType: upload.type || 'application/octet-stream',
          byteSize: upload.size,
          originalWidth: imageMetadata.width,
          originalHeight: imageMetadata.height,
          exifOrientation: imageMetadata.orientation,
        },
      });
      const photo = await tx.samplePhoto.create({
        data: {
          taskId: fresh.id,
          linkedEntryId,
          clientMutationId,
          requestHash,
          category,
          caption,
          originalName: upload.name,
          mimeType: upload.type || 'application/octet-stream',
          size: upload.size,
          objectKey: objectKey!,
          mediaAssetId: mediaAsset.id,
          sha256,
          captureSource,
          sourceOriginalName,
          sortOrder,
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
          detail: { taskId: fresh.id, taskCode: fresh.code, category, size: upload.size, sha256, linkedEntryId, clientMutationId, requestHash, sortOrder, sourceOriginalName, baseTaskVersion: expectedTaskVersion, appliedTaskVersion: fresh.version },
        },
      });
      return { id: photo.id, duplicate: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    if (photoResult.duplicate && objectKey) await deleteObjectsBestEffort([objectKey]);
    objectKey = null;
    failureStage = 'response';
    const photo = await prisma.samplePhoto.findUnique({ where: { id: photoResult.id }, select: { taskId: true } });
    const updated = photo
      ? await prisma.sampleTask.findUnique({ where: { id: photo.taskId }, include: sampleTaskInclude })
      : null;
    return NextResponse.json({ ok: true, task: updated ? serializeSampleTask(updated) : null, photoId: photoResult.id, deduplicated: photoResult.duplicate }, { status: photoResult.duplicate ? 200 : 201 });
  } catch (error) {
    if (objectKey) await deleteObjectsBestEffort([objectKey]);
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof SamplePhotoRequestError) {
      const incidentId = crypto.randomUUID();
      console.error('parse sample photo request failed', {
        incidentId,
        code: error.code,
        protocol: req.headers.get('x-sample-photo-protocol') || 'multipart',
        contentType: req.headers.get('content-type'),
        contentLength: req.headers.get('content-length'),
        detail: error.detail,
      });
      return NextResponse.json({ ok: false, code: error.code, error: error.publicMessage, incidentId }, { status: error.status });
    }
    if (error instanceof Error) {
      if (error.message === 'SAMPLE_TASK_NOT_FOUND') return NextResponse.json({ ok: false, error: '样品任务不存在' }, { status: 404 });
      if (error.message === 'SAMPLE_TASK_CONFLICT') return NextResponse.json({ ok: false, error: '样品任务已被其他人修改，请刷新后重试' }, { status: 409 });
      if (error.message === 'SAMPLE_TASK_CLOSED') return NextResponse.json({ ok: false, error: '已完成或已取消任务不能继续上传' }, { status: 409 });
      if (error.message === 'SAMPLE_TASK_SUBMITTED') return NextResponse.json({ ok: false, error: '样品数据已经提交，请先撤回提交再上传照片' }, { status: 409 });
      if (error.message === 'SAMPLE_PHOTO_MUTATION_CONFLICT') return NextResponse.json({ ok: false, error: '同一照片上传编号对应了不同文件，请重新选择照片' }, { status: 409 });
      if (error.message === 'SAMPLE_PHOTO_MUTATION_TOMBSTONED') return NextResponse.json({ ok: false, error: '该照片上传记录已经删除，请使用新的上传编号' }, { status: 409 });
      if (error.message === 'SAMPLE_LINKED_ENTRY_NOT_FOUND') return NextResponse.json({ ok: false, error: '关联的采集记录不存在，请刷新后重试' }, { status: 409 });
    }
    const incidentId = crypto.randomUUID();
    console.error('upload sample photo failed', { incidentId, stage: failureStage, error });
    const storageFailure = failureStage === 'object-storage';
    return NextResponse.json({
      ok: false,
      code: storageFailure ? 'SAMPLE_PHOTO_STORAGE_WRITE_FAILED' : 'SAMPLE_PHOTO_UPLOAD_FAILED',
      error: storageFailure ? '照片暂时无法写入对象存储，请保留照片后重试' : '照片上传处理失败，请保留照片后重试',
      incidentId,
    }, { status: storageFailure ? 503 : 500 });
  }
}
