import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serializeFile(f: {
  id: string;
  workOrderId: string;
  categoryId: string;
  originalName: string;
  displayName: string | null;
  remark: string | null;
  mimeType: string;
  fileType: string;
  fileSize: number;
  version: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  uploadedBy?: { displayName: string } | null;
  category?: { name: string; code: string } | null;
}) {
  return {
    id: f.id,
    workOrderId: f.workOrderId,
    categoryId: f.categoryId,
    categoryName: f.category?.name || null,
    categoryCode: f.category?.code || null,
    originalName: f.originalName,
    displayName: f.displayName,
    remark: f.remark,
    mimeType: f.mimeType,
    fileType: f.fileType,
    fileSize: f.fileSize,
    version: f.version || 'V1.0',
    status: f.status,
    uploadedBy: f.uploadedBy?.displayName || null,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
    contentUrl: `/api/resource-files/${f.id}/content`,
    viewUrl: `/api/resource-files/${f.id}/view`,
    downloadUrl: `/api/resource-files/${f.id}/download`,
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const workOrderId = req.nextUrl.searchParams.get('workOrderId') || undefined;
    const categoryId = req.nextUrl.searchParams.get('categoryId') || undefined;
    if (!workOrderId) return NextResponse.json({ message: '缺少工单参数' }, { status: 400 });

    const [workOrder, files] = await Promise.all([
      prisma.workOrder.findFirst({
        where: { id: workOrderId, deletedAt: null },
        select: { id: true, code: true, specification: true, libraryKey: true },
      }),
      prisma.resourceFile.findMany({
      where: {
        workOrderId,
        ...(categoryId ? { categoryId } : {}),
        deletedAt: null,
        status: 'uploaded',
      },
      include: {
        uploadedBy: { select: { displayName: true } },
        category: { select: { name: true, code: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { version: 'desc' }],
      }),
    ]);

    const key = workOrder?.libraryKey?.trim() || workOrder?.specification?.trim() || workOrder?.code?.trim() || '';
    let relatedHistory: { fileCount: number; workOrderCount: number } | null = null;
    if (key && files.length === 0) {
      const related = await prisma.resourceFile.findMany({
        where: {
          ...(categoryId ? { categoryId } : {}),
          deletedAt: null,
          status: 'uploaded',
          workOrderId: { not: workOrderId },
          workOrder: {
            deletedAt: null,
            OR: [
              { libraryKey: key },
              { specification: key },
            ],
          },
        },
        select: { workOrderId: true },
        take: 200,
      });
      if (related.length) relatedHistory = { fileCount: related.length, workOrderCount: new Set(related.map(item => item.workOrderId)).size };
    }

    return NextResponse.json({ files: files.map(serializeFile), relatedHistory });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ message: '文件加载失败' }, { status: 500 });
  }
}
