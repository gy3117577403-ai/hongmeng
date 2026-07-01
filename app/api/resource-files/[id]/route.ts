import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clean(v: unknown, max = 200) {
  if (typeof v !== 'string') return null;
  const next = v.trim();
  return next ? next.slice(0, max) : null;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const old = await prisma.resourceFile.findFirst({ where: { id: params.id, deletedAt: null, status: 'uploaded' } });
    if (!old) return NextResponse.json({ message: '文件不存在' }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const displayName = clean(body.displayName, 160);
    const remark = clean(body.remark, 500);

    const file = await prisma.resourceFile.update({
      where: { id: old.id },
      data: { displayName, remark },
      include: {
        uploadedBy: { select: { displayName: true } },
        category: { select: { name: true, code: true } },
      },
    });

    await logOp({
      userId: user.id,
      action: 'update_resource_file',
      targetType: 'resource_file',
      targetId: file.id,
      detail: { displayName: file.displayName, hasRemark: !!file.remark },
    });

    return NextResponse.json({
      file: {
        id: file.id,
        workOrderId: file.workOrderId,
        categoryId: file.categoryId,
        categoryName: file.category.name,
        categoryCode: file.category.code,
        originalName: file.originalName,
        displayName: file.displayName,
        remark: file.remark,
        mimeType: file.mimeType,
        fileType: file.fileType,
        fileSize: file.fileSize,
        version: file.version || 'V1.0',
        status: file.status,
        uploadedBy: file.uploadedBy?.displayName || null,
        createdAt: file.createdAt.toISOString(),
        updatedAt: file.updatedAt.toISOString(),
        viewUrl: `/api/resource-files/${file.id}/view`,
        downloadUrl: `/api/resource-files/${file.id}/download`,
      },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ message: '文件信息保存失败' }, { status: 500 });
  }
}
