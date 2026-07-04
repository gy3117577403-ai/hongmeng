import { NextRequest } from 'next/server';
import { resourceFileSnapshot, snapshotChange } from '@/lib/change-snapshots';
import { logOp } from '@/lib/logs';
import { NativeUnauthorizedError, nativeError, nativeFileDto, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireNativeUser(req);
    const body = await req.json().catch(() => ({})) as { confirmText?: unknown };
    if (String(body.confirmText || '').trim() !== 'DELETE') return nativeError('删除确认不匹配', 400);

    const old = await prisma.resourceFile.findFirst({
      where: { id: params.id, deletedAt: null, status: 'uploaded' },
      include: {
        uploadedBy: { select: { displayName: true, username: true } },
        workOrder: { select: { code: true } },
        category: { select: { name: true, code: true } },
      },
    });
    if (!old) return nativeError('文件不存在', 404);

    const file = await prisma.resourceFile.update({
      where: { id: params.id },
      data: { status: 'deleted', deletedAt: new Date() },
      include: {
        uploadedBy: { select: { displayName: true, username: true } },
        workOrder: { select: { code: true } },
        category: { select: { name: true, code: true } },
      },
    });

    await logOp({
      userId: user.id,
      action: 'delete_resource_file',
      targetType: 'resource_file',
      targetId: file.id,
      detail: {
        client: 'harmony_native',
        fileName: file.displayName || file.originalName,
        version: file.version,
        softDelete: true,
      },
    });
    await snapshotChange({
      entityType: 'resource_file',
      entityId: file.id,
      action: 'delete_resource_file',
      before: resourceFileSnapshot(old),
      after: resourceFileSnapshot(file),
      changedBy: user.displayName || user.username,
    });

    return nativeOk({ deleted: true, file: nativeFileDto(file) });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('文件删除失败', 500);
  }
}
