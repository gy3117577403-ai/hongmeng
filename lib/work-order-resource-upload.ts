import crypto from 'node:crypto';
import { syncResourceFileToDrawingLibrary } from '@/lib/drawing-library-sync';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { serializeResourceFile } from '@/lib/resource-files';
import { getObjectStream, putObject } from '@/lib/s3';
import { fileType, safeFilename, validateFile } from '@/lib/validation';

export type UploadableResource = {
  name: string;
  mimeType: string;
  size: number;
  body: Buffer;
  sha256?: string;
};

export type ResourceDuplicateStatus = 'new' | 'duplicate' | 'new_version' | 'conflict';

export type ResourceDuplicateResult = {
  status: ResourceDuplicateStatus;
  existingFileId?: string;
  existingVersion?: string;
  suggestedVersion: string;
  reason: string;
};

export class ResourceUploadError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

function ymd(date: Date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

function versionMinor(version?: string | null) {
  const match = String(version || '').match(/^V1\.(\d+)$/i);
  return match ? Number(match[1]) : -1;
}

export async function nextResourceVersion(workOrderId: string, categoryId: string) {
  const files = await prisma.resourceFile.findMany({ where: { workOrderId, categoryId }, select: { version: true } });
  const max = files.reduce((value, file) => Math.max(value, versionMinor(file.version)), -1);
  return `V1.${max + 1}`;
}

export function sha256Buffer(body: Buffer) {
  return crypto.createHash('sha256').update(body).digest('hex');
}

function hashFromObjectKey(key: string) {
  return key.match(/sha256-([a-f0-9]{64})-/i)?.[1]?.toLowerCase() || '';
}

async function hashStoredObject(key: string) {
  const stream = await getObjectStream(key);
  const hash = crypto.createHash('sha256');
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export async function inspectResourceDuplicate(input: {
  workOrderId: string;
  categoryId: string;
  fileName: string;
  size: number;
  sha256: string;
}): Promise<ResourceDuplicateResult> {
  const suggestedVersion = await nextResourceVersion(input.workOrderId, input.categoryId);
  const files = await prisma.resourceFile.findMany({
    where: { workOrderId: input.workOrderId, categoryId: input.categoryId, deletedAt: null, status: 'uploaded' },
    select: { id: true, originalName: true, fileSize: true, objectKey: true, version: true },
    orderBy: { createdAt: 'desc' },
  });
  const normalizedName = input.fileName.trim().toLowerCase();
  const sameSize = files.filter(file => file.fileSize === input.size);
  let hashReadFailed = false;

  for (const file of sameSize.slice(0, 50)) {
    let existingHash = hashFromObjectKey(file.objectKey);
    if (!existingHash) {
      try {
        existingHash = await hashStoredObject(file.objectKey);
      } catch {
        hashReadFailed = true;
      }
    }
    if (existingHash && existingHash === input.sha256.toLowerCase()) {
      return { status: 'duplicate', existingFileId: file.id, existingVersion: file.version, suggestedVersion, reason: 'same_sha256' };
    }
  }

  const sameName = files.find(file => file.originalName.trim().toLowerCase() === normalizedName);
  if (sameName) {
    if (hashReadFailed && sameName.fileSize === input.size) {
      return { status: 'conflict', existingFileId: sameName.id, existingVersion: sameName.version, suggestedVersion, reason: 'same_name_size_hash_unavailable' };
    }
    return { status: 'new_version', existingFileId: sameName.id, existingVersion: sameName.version, suggestedVersion, reason: 'same_name_different_content' };
  }
  return { status: 'new', suggestedVersion, reason: hashReadFailed ? 'no_match_some_hashes_unavailable' : 'no_match' };
}

export function validateResourceContent(file: UploadableResource) {
  const genericError = validateFile(file.name, file.mimeType, file.size);
  if (genericError) return genericError;
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.pdf') || file.mimeType === 'application/pdf') {
    return file.body.subarray(0, 5).toString('ascii') === '%PDF-' ? null : 'PDF 文件头无效';
  }
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || file.mimeType === 'image/jpeg') {
    return file.body.length >= 3 && file.body[0] === 0xff && file.body[1] === 0xd8 && file.body[2] === 0xff ? null : 'JPEG 文件头无效';
  }
  if (lower.endsWith('.png') || file.mimeType === 'image/png') {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return file.body.subarray(0, 8).equals(png) ? null : 'PNG 文件头无效';
  }
  if (lower.endsWith('.webp') || file.mimeType === 'image/webp') {
    return file.body.subarray(0, 4).toString('ascii') === 'RIFF' && file.body.subarray(8, 12).toString('ascii') === 'WEBP' ? null : 'WEBP 文件头无效';
  }
  return '文件类型不受支持';
}

export async function uploadWorkOrderResource(input: {
  userId: string;
  workOrderId: string;
  categoryId: string;
  file: UploadableResource;
  logAction: string;
  logTargetType?: string;
  logTargetId?: string;
  logDetail?: Record<string, string | number | boolean | null | undefined>;
}) {
  const validationError = validateFile(input.file.name, input.file.mimeType, input.file.size);
  if (validationError) throw new ResourceUploadError(validationError, 400);
  const [workOrder, category] = await Promise.all([
    prisma.workOrder.findFirst({ where: { id: input.workOrderId, deletedAt: null } }),
    prisma.resourceCategory.findUnique({ where: { id: input.categoryId } }),
  ]);
  if (!workOrder || !category) throw new ResourceUploadError('工单或分类不存在', 404);

  const sha256 = input.file.sha256 || sha256Buffer(input.file.body);
  const objectKey = `work-orders/${workOrder.code}/${category.code}/${ymd(new Date())}/sha256-${sha256}-${crypto.randomUUID()}-${safeFilename(input.file.name)}`;
  await putObject({
    key: objectKey,
    body: input.file.body,
    contentType: input.file.mimeType || 'application/octet-stream',
    originalName: input.file.name,
  });

  const resourceFile = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${workOrder.id}:${category.id}`}))`;
    const files = await tx.resourceFile.findMany({ where: { workOrderId: workOrder.id, categoryId: category.id }, select: { version: true } });
    const version = `V1.${files.reduce((value, file) => Math.max(value, versionMinor(file.version)), -1) + 1}`;
    return tx.resourceFile.create({
      data: {
        workOrderId: workOrder.id,
        categoryId: category.id,
        originalName: input.file.name,
        mimeType: input.file.mimeType || 'application/octet-stream',
        fileType: fileType(input.file.name, input.file.mimeType),
        fileSize: input.file.size,
        objectKey,
        version,
        uploadedById: input.userId,
      },
    });
  });
  const version = resourceFile.version;
  const drawingLibrarySync = await syncResourceFileToDrawingLibrary(resourceFile.id, input.userId).catch(error => ({
    linked: false,
    error: error instanceof Error ? error.message : '图纸资料库同步失败',
  }));

  await logOp({
    userId: input.userId,
    action: input.logAction,
    targetType: input.logTargetType || 'resource_file',
    targetId: input.logTargetId || resourceFile.id,
    detail: {
      resourceFileId: resourceFile.id,
      fileName: input.file.name,
      fileSize: input.file.size,
      workOrderId: workOrder.id,
      workOrderCode: workOrder.code,
      categoryId: category.id,
      categoryCode: category.code,
      version,
      sha256Prefix: sha256.slice(0, 12),
      drawingLibraryLinked: drawingLibrarySync.linked,
      ...input.logDetail,
    },
  });

  return {
    file: serializeResourceFile(resourceFile),
    drawingLibrarySync,
    sha256,
    version,
  };
}
