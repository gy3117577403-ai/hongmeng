import { ensureDrawingLibraryItemForWorkOrder } from '@/lib/drawing-library';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const drawingLibrarySyncCategoryCodes = new Set(['drawing', 'sop', 'product', 'material', 'notice']);

export type DrawingLibrarySyncResult = {
  linked: boolean;
  skipped?: boolean;
  itemId?: string;
  fileId?: string;
  error?: string;
  reason?: string;
};

export type WorkOrderDrawingLibrarySyncResult = {
  ok: true;
  totalFiles: number;
  syncedCount: number;
  skippedCount: number;
  failedCount: number;
  itemId?: string;
  results: DrawingLibrarySyncResult[];
};

export function isDrawingLibrarySyncCategory(code?: string | null) {
  return !!code && drawingLibrarySyncCategoryCodes.has(code);
}

function shortReason(reason: string) {
  return reason.length > 120 ? `${reason.slice(0, 117)}...` : reason;
}

export async function syncResourceFileToDrawingLibrary(resourceFileId: string, userId?: string | null): Promise<DrawingLibrarySyncResult> {
  const resourceFile = await prisma.resourceFile.findFirst({
    where: { id: resourceFileId, deletedAt: null, status: 'uploaded' },
    include: {
      workOrder: true,
      category: { select: { id: true, code: true, name: true } },
    },
  });

  if (!resourceFile) {
    return { linked: false, skipped: true, reason: 'resource_file_missing', error: '生产资料文件不存在或已删除' };
  }
  if (!isDrawingLibrarySyncCategory(resourceFile.category.code)) {
    return { linked: false, skipped: true, reason: 'category_not_synced', error: '当前分类不需要归档到图纸资料库' };
  }
  if (!resourceFile.workOrder || resourceFile.workOrder.deletedAt) {
    return { linked: false, skipped: true, reason: 'work_order_missing', error: '工单不存在或已删除' };
  }
  if (!resourceFile.workOrder.specification?.trim()) {
    return {
      linked: false,
      skipped: true,
      reason: 'missing_specification',
      error: '当前工单未设置规格，资料已保存到生产工单，未归档到图纸资料库',
    };
  }

  const linkedItem = resourceFile.workOrder.drawingLibraryItemId
    ? await prisma.drawingLibraryItem.findFirst({ where: { id: resourceFile.workOrder.drawingLibraryItemId, deletedAt: null } })
    : null;
  const item = linkedItem || await ensureDrawingLibraryItemForWorkOrder(resourceFile.workOrder);
  if (!item) {
    return { linked: false, skipped: true, reason: 'library_item_missing', error: '无法创建或定位图纸资料库记录' };
  }

  const existing = await prisma.drawingLibraryFile.findFirst({
    where: {
      OR: [
        { sourceResourceFileId: resourceFile.id },
        { objectKey: resourceFile.objectKey },
      ],
    },
    select: { id: true, libraryItemId: true, sourceResourceFileId: true, deletedAt: true },
  });

  if (existing) {
    if (!existing.sourceResourceFileId) {
      try {
        await prisma.drawingLibraryFile.update({
          where: { id: existing.id },
          data: { sourceResourceFileId: resourceFile.id },
        });
      } catch {
        // Existing objectKey already prevents duplicate sync. Linking is best-effort for old records.
      }
    }
    if (!resourceFile.workOrder.drawingLibraryItemId) {
      await prisma.workOrder.update({ where: { id: resourceFile.workOrder.id }, data: { drawingLibraryItemId: existing.libraryItemId } });
    }
    return {
      linked: !existing.deletedAt,
      skipped: true,
      itemId: existing.libraryItemId,
      fileId: existing.id,
      reason: existing.deletedAt ? 'existing_deleted_file' : 'already_synced',
      error: existing.deletedAt ? '图纸资料库中已存在同源文件但处于删除状态，未重复创建' : undefined,
    };
  }

  const file = await prisma.drawingLibraryFile.create({
    data: {
      libraryItemId: item.id,
      categoryId: resourceFile.categoryId,
      originalName: resourceFile.originalName,
      displayName: resourceFile.displayName,
      mimeType: resourceFile.mimeType,
      size: resourceFile.fileSize,
      version: resourceFile.version || 'V1.0',
      objectKey: resourceFile.objectKey,
      uploadedById: resourceFile.uploadedById,
      sourceResourceFileId: resourceFile.id,
      remark: resourceFile.remark,
    },
    select: { id: true, libraryItemId: true },
  });

  if (!resourceFile.workOrder.drawingLibraryItemId || resourceFile.workOrder.drawingLibraryItemId !== item.id) {
    await prisma.workOrder.update({ where: { id: resourceFile.workOrder.id }, data: { drawingLibraryItemId: item.id } });
  }
  await prisma.drawingLibraryItem.update({ where: { id: item.id }, data: { updatedAt: new Date(), lastWorkOrderId: resourceFile.workOrder.id, lastImportedAt: new Date() } });
  await logOp({
    userId: userId || resourceFile.uploadedById,
    action: 'sync_resource_file_to_drawing_library',
    targetType: 'drawing_library_file',
    targetId: file.id,
    detail: {
      resourceFileId: resourceFile.id,
      workOrderId: resourceFile.workOrder.id,
      categoryCode: resourceFile.category.code,
      fileName: resourceFile.originalName,
      fileSize: resourceFile.fileSize,
      version: resourceFile.version || 'V1.0',
      source: 'work_order_resource_file',
    },
  });

  return { linked: true, itemId: file.libraryItemId, fileId: file.id, reason: 'created' };
}

export async function syncWorkOrderFilesToDrawingLibrary(workOrderId: string, userId?: string | null): Promise<WorkOrderDrawingLibrarySyncResult> {
  const workOrder = await prisma.workOrder.findFirst({
    where: { id: workOrderId, deletedAt: null },
    select: { id: true, code: true, specification: true },
  });
  if (!workOrder) throw new Error('工单不存在或已删除');
  if (!workOrder.specification?.trim()) throw new Error('当前工单未设置规格，无法同步到图纸资料库');

  const files = await prisma.resourceFile.findMany({
    where: { workOrderId, deletedAt: null, status: 'uploaded' },
    include: { category: { select: { code: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const candidates = files.filter(file => isDrawingLibrarySyncCategory(file.category.code));
  const results: DrawingLibrarySyncResult[] = [];

  for (const file of candidates) {
    try {
      results.push(await syncResourceFileToDrawingLibrary(file.id, userId));
    } catch (error) {
      results.push({
        linked: false,
        skipped: false,
        reason: 'sync_failed',
        error: shortReason(error instanceof Error ? error.message : String(error)),
      });
    }
  }

  const syncedCount = results.filter(result => result.linked && !result.skipped).length;
  const failedCount = results.filter(result => !result.linked && !result.skipped).length;
  const skippedCount = results.length - syncedCount - failedCount;
  const itemId = results.find(result => result.itemId)?.itemId;

  await logOp({
    userId,
    action: 'sync_work_order_to_drawing_library',
    targetType: 'work_order',
    targetId: workOrder.id,
    detail: { code: workOrder.code, totalFiles: candidates.length, syncedCount, skippedCount, failedCount },
  });

  return {
    ok: true,
    totalFiles: candidates.length,
    syncedCount,
    skippedCount,
    failedCount,
    itemId,
    results,
  };
}
