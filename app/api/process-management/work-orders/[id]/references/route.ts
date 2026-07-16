import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { findDrawingLibraryItemForWorkOrder, serializeDrawingLibraryFile } from '@/lib/drawing-library';
import { prisma } from '@/lib/prisma';
import { serializeResourceFile } from '@/lib/resource-files';
import type {
  ProcessReferenceCategoryDTO,
  ProcessReferenceFileDTO,
  ProcessReferencePayloadDTO,
} from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REFERENCE_CODES = ['drawing', 'sop'] as const;
type ReferenceCategoryCode = (typeof REFERENCE_CODES)[number];

function referenceCode(value?: string | null): value is ReferenceCategoryCode {
  return REFERENCE_CODES.includes(value as ReferenceCategoryCode);
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: params.id, deletedAt: null },
      select: {
        id: true,
        code: true,
        customerName: true,
        specification: true,
        drawingLibraryItemId: true,
        resourceFiles: {
          where: {
            deletedAt: null,
            status: 'uploaded',
            category: { code: { in: [...REFERENCE_CODES] } },
          },
          include: {
            category: { select: { id: true, name: true, code: true, sortOrder: true } },
            uploadedBy: { select: { displayName: true, username: true } },
          },
          orderBy: [{ category: { sortOrder: 'asc' } }, { createdAt: 'desc' }],
        },
      },
    });
    if (!workOrder) {
      return NextResponse.json({ ok: false, error: '工单不存在或已删除' }, { status: 404 });
    }

    const linkedItem = workOrder.drawingLibraryItemId
      ? await prisma.drawingLibraryItem.findFirst({
          where: { id: workOrder.drawingLibraryItemId, deletedAt: null },
          include: {
            files: {
              where: {
                deletedAt: null,
                category: { code: { in: [...REFERENCE_CODES] } },
              },
              include: {
                category: { select: { id: true, name: true, code: true, sortOrder: true } },
                uploadedBy: { select: { displayName: true, username: true } },
              },
              orderBy: [{ category: { sortOrder: 'asc' } }, { createdAt: 'desc' }],
            },
          },
        })
      : await findDrawingLibraryItemForWorkOrder(workOrder).then(async item => {
          if (!item) return null;
          return prisma.drawingLibraryItem.findFirst({
            where: { id: item.id, deletedAt: null },
            include: {
              files: {
                where: {
                  deletedAt: null,
                  category: { code: { in: [...REFERENCE_CODES] } },
                },
                include: {
                  category: { select: { id: true, name: true, code: true, sortOrder: true } },
                  uploadedBy: { select: { displayName: true, username: true } },
                },
                orderBy: [{ category: { sortOrder: 'asc' } }, { createdAt: 'desc' }],
              },
            },
          });
        });

    const currentResourceIds = new Set(workOrder.resourceFiles.map(file => file.id));
    const workOrderFiles: ProcessReferenceFileDTO[] = workOrder.resourceFiles.flatMap(file => {
      const serialized = serializeResourceFile(file);
      if (!referenceCode(serialized.categoryCode)) return [];
      return [{
        id: serialized.id,
        source: 'work_order',
        sourceLabel: '当前工单',
        workOrderId: serialized.workOrderId,
        libraryItemId: null,
        categoryId: serialized.categoryId,
        categoryName: serialized.categoryName || (serialized.categoryCode === 'drawing' ? '原图' : 'SOP指导书'),
        categoryCode: serialized.categoryCode,
        originalName: serialized.originalName,
        displayName: serialized.displayName,
        mimeType: serialized.mimeType,
        fileType: serialized.fileType === 'pdf' || serialized.fileType === 'image' ? serialized.fileType : 'other',
        fileSize: serialized.fileSize,
        version: serialized.version,
        createdAt: serialized.createdAt,
        contentUrl: serialized.contentUrl,
        downloadUrl: serialized.downloadUrl,
      }];
    });
    const drawingLibraryFiles: ProcessReferenceFileDTO[] = (linkedItem?.files || []).flatMap(file => {
      if (file.sourceResourceFileId && currentResourceIds.has(file.sourceResourceFileId)) return [];
      const serialized = serializeDrawingLibraryFile(file);
      if (!referenceCode(serialized.categoryCode)) return [];
      return [{
        id: serialized.id,
        source: 'drawing_library',
        sourceLabel: '图纸资料库',
        workOrderId: null,
        libraryItemId: serialized.libraryItemId,
        categoryId: serialized.categoryId,
        categoryName: serialized.categoryName || (serialized.categoryCode === 'drawing' ? '原图' : 'SOP指导书'),
        categoryCode: serialized.categoryCode,
        originalName: serialized.originalName,
        displayName: serialized.displayName,
        mimeType: serialized.mimeType,
        fileType: serialized.fileType === 'pdf' || serialized.fileType === 'image' ? serialized.fileType : 'other',
        fileSize: serialized.fileSize,
        version: serialized.version,
        createdAt: serialized.createdAt,
        contentUrl: serialized.contentUrl,
        downloadUrl: serialized.downloadUrl,
      }];
    });
    const files = [...workOrderFiles, ...drawingLibraryFiles];
    const categories: ProcessReferenceCategoryDTO[] = [
      { code: 'drawing', name: '原图', fileCount: files.filter(file => file.categoryCode === 'drawing').length },
      { code: 'sop', name: 'SOP指导书', fileCount: files.filter(file => file.categoryCode === 'sop').length },
    ];
    const payload: ProcessReferencePayloadDTO = {
      workOrderId: workOrder.id,
      drawingLibraryItemId: linkedItem?.id || null,
      categories,
      files,
    };
    return NextResponse.json({ ok: true, references: payload });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('process reference files failed', error);
    return NextResponse.json({ ok: false, error: '工艺参考资料加载失败' }, { status: 500 });
  }
}
