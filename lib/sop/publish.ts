import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { serializeDrawingLibraryFile } from '@/lib/drawing-library';
import { synchronizeDrawingLibraryWorkOrderStatus } from '@/lib/drawing-library-lifecycle';
import {
  SopRequestError,
  SOP_WRITE_ACCESS,
  assertExpectedRevision,
  assertMutableDraft,
  nextDrawingLibraryMinorVersion,
  onlineGeneratedSopFileIdsToArchive,
  validateSopContent,
} from '@/lib/sop';
import { prisma } from '@/lib/prisma';
import { reconcileProductionPlanDrawingLinks } from '@/lib/planning-product-link';
import { deleteObjectsBestEffort, putObject } from '@/lib/s3';
import {
  assertSopAssetsAvailable,
  cleanSopTitle,
  createSopOperationLog,
  expectedSopRevision,
  findSopVersionForItem,
  loadSopWorkspaceByItemId,
  lockSopScope,
} from '@/lib/sop/server';
import { sopRouteError } from '@/lib/sop/http';
import { fileType, safeFilename, validateFileContent } from '@/lib/validation';

function datePart(date: Date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

function formText(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function publishedDisplayName(title: string) {
  return `${title.replace(/\.pdf$/i, '').trim() || '在线 SOP'}.pdf`;
}

type PublishResult = {
  file: Awaited<ReturnType<typeof createPublishedSopFile>>['file'];
  sync: Awaited<ReturnType<typeof createPublishedSopFile>>['sync'];
};

async function createPublishedSopFile(input: {
  tx: Prisma.TransactionClient;
  itemId: string;
  versionId: string;
  expectedRevision: number;
  title: string | null;
  objectKey: string;
  originalName: string;
  mimeType: string;
  size: number;
  userId: string;
}) {
  const { tx } = input;
  await lockSopScope(tx, input.itemId);
  const current = await findSopVersionForItem(tx, input.itemId, input.versionId);
  assertMutableDraft(current);
  assertExpectedRevision(current.revision, input.expectedRevision);

  const content = validateSopContent(current.content);
  const assetIds = await assertSopAssetsAvailable(tx, current.documentId, content);
  const title = cleanSopTitle(input.title, current.title);
  const category = await tx.resourceCategory.findUnique({ where: { code: 'sop' } });
  if (!category) throw new SopRequestError('系统尚未配置 SOP 资料分类', 409, 'SOP_CATEGORY_NOT_CONFIGURED');

  const existingFiles = await tx.drawingLibraryFile.findMany({
    where: { libraryItemId: input.itemId, categoryId: category.id },
    select: { id: true, version: true, sourceSopVersionId: true, deletedAt: true },
  });
  const archivedFileIds = onlineGeneratedSopFileIdsToArchive(existingFiles);
  if (archivedFileIds.length) {
    await tx.drawingLibraryFile.updateMany({
      where: { id: { in: archivedFileIds }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  const file = await tx.drawingLibraryFile.create({
    data: {
      libraryItemId: input.itemId,
      categoryId: category.id,
      originalName: input.originalName,
      displayName: publishedDisplayName(title),
      mimeType: input.mimeType,
      size: input.size,
      version: nextDrawingLibraryMinorVersion(existingFiles.map(existing => existing.version)),
      objectKey: input.objectKey,
      uploadedById: input.userId,
      sourceSopVersionId: current.id,
      remark: `在线 SOP 发布：${title}`,
    },
    include: {
      category: { select: { id: true, name: true, code: true, sortOrder: true } },
      uploadedBy: { select: { displayName: true, username: true } },
    },
  });

  const publishedAt = new Date();
  const updated = await tx.sopVersion.updateMany({
    where: {
      id: current.id,
      revision: input.expectedRevision,
      status: 'draft',
      deletedAt: null,
    },
    data: {
      title,
      status: 'published',
      revision: { increment: 1 },
      publishedAt,
      publishedById: input.userId,
      updatedById: input.userId,
    },
  });
  if (updated.count !== 1) {
    throw new SopRequestError('文档已被其他人更新，请刷新后重新发布', 409, 'SOP_REVISION_CONFLICT');
  }
  await tx.sopDocument.update({
    where: { id: current.documentId },
    data: {
      title,
      currentPublishedVersionId: current.id,
      updatedById: input.userId,
    },
  });
  await tx.drawingLibraryItem.update({ where: { id: input.itemId }, data: { updatedAt: publishedAt } });

  const planning = await reconcileProductionPlanDrawingLinks(tx, { drawingLibraryItemId: input.itemId });
  const workOrders = await synchronizeDrawingLibraryWorkOrderStatus(tx, input.itemId);
  const sync = { planning, workOrders };
  await createSopOperationLog(tx, {
    userId: input.userId,
    action: 'publish_sop_version',
    targetType: 'sop_version',
    targetId: current.id,
    detail: {
      itemId: input.itemId,
      fileId: file.id,
      sourceRevision: input.expectedRevision,
      publishedRevision: input.expectedRevision + 1,
      archivedFileIds,
      assetIds,
      sync,
    } as unknown as Prisma.InputJsonValue,
  });
  return { file, sync };
}

export async function publishSopVersion(
  req: NextRequest,
  itemId: string,
  routeVersionId?: string,
) {
  let objectKey: string | null = null;
  try {
    const user = await requireUser({ write: SOP_WRITE_ACCESS });
    const form = await req.formData();
    const versionId = routeVersionId?.trim() || formText(form, 'versionId');
    if (!versionId) throw new SopRequestError('缺少要发布的 SOP 版本');
    const expectedRevision = expectedSopRevision(form);
    const upload = form.get('pdf') ?? form.get('file');
    if (!(upload instanceof File)) throw new SopRequestError('请选择要发布的 SOP PDF');
    const body = Buffer.from(await upload.arrayBuffer());
    const validationError = validateFileContent(upload.name, upload.type, upload.size, body);
    if (validationError) throw new SopRequestError(validationError);
    if (fileType(upload.name, upload.type) !== 'pdf') throw new SopRequestError('发布文件必须是 PDF');

    const ownedVersion = await prisma.sopVersion.findFirst({
      where: {
        id: versionId,
        document: { drawingLibraryItemId: itemId, deletedAt: null, drawingLibraryItem: { deletedAt: null } },
      },
      select: { id: true },
    });
    if (!ownedVersion) throw new SopRequestError('SOP 版本不存在或不属于当前产品', 404, 'SOP_VERSION_NOT_FOUND');

    const mimeType = 'application/pdf';
    objectKey = `drawing-library/${itemId}/sop/${datePart(new Date())}/${crypto.randomUUID()}-${safeFilename(upload.name)}`;
    await putObject({ key: objectKey, body, contentType: mimeType, originalName: upload.name });

    let result: PublishResult;
    try {
      result = await prisma.$transaction(tx => createPublishedSopFile({
        tx,
        itemId,
        versionId,
        expectedRevision,
        title: formText(form, 'title') || null,
        objectKey: objectKey!,
        originalName: upload.name,
        mimeType,
        size: upload.size,
        userId: user.id,
      }));
    } catch (error) {
      await deleteObjectsBestEffort([objectKey]);
      objectKey = null;
      throw error;
    }
    objectKey = null;

    const workspace = await loadSopWorkspaceByItemId(prisma, itemId);
    return NextResponse.json({
      ok: true,
      workspace,
      version: workspace.publishedVersion,
      file: serializeDrawingLibraryFile(result.file),
      publishedDrawingLibraryFileId: result.file.id,
      sync: result.sync,
    });
  } catch (error) {
    if (objectKey) await deleteObjectsBestEffort([objectKey]);
    return sopRouteError(error, '发布 SOP 失败，请检查对象存储配置');
  }
}
