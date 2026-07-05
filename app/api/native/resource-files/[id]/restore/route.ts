import { logOp } from '@/lib/logs';
import { NativeUnauthorizedError, nativeError, nativeFileDto, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';
import { resourceFileSnapshot, snapshotChange } from '@/lib/change-snapshots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireNativeUser(req);
    const old = await prisma.resourceFile.findUnique({ where: { id: params.id } });
    if (!old) return nativeError('文件不存在', 404);
    const file = await prisma.resourceFile.update({
      where: { id: params.id },
      data: { deletedAt: null, status: 'uploaded' },
      include: {
        uploadedBy: { select: { displayName: true, username: true } },
        workOrder: { select: { code: true } },
        category: { select: { name: true, code: true } },
      },
    });
    await logOp({ userId: user.id, action: 'restore_resource_file', targetType: 'resource_file', targetId: file.id, detail: { fileName: file.displayName || file.originalName, client: 'harmony_native' } });
    await snapshotChange({
      entityType: 'resource_file',
      entityId: file.id,
      action: 'restore_resource_file',
      before: resourceFileSnapshot(old),
      after: resourceFileSnapshot(file),
      changedBy: user.displayName || user.username,
    });
    return nativeOk({ file: nativeFileDto(file, user.id) });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('恢复文件失败', 500);
  }
}
