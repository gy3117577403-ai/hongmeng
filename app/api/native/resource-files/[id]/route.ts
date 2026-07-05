import { NextRequest } from 'next/server';
import { resourceFileSnapshot, snapshotChange } from '@/lib/change-snapshots';
import { logOp } from '@/lib/logs';
import { NativeUnauthorizedError, nativeError, nativeFileDto, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clean(value: unknown, max = 200) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireNativeUser(req);
    const old = await prisma.resourceFile.findFirst({
      where: { id: params.id, deletedAt: null, status: 'uploaded' },
      include: {
        uploadedBy: { select: { displayName: true, username: true } },
        workOrder: { select: { code: true } },
        category: { select: { name: true, code: true } },
      },
    });
    if (!old) return nativeError('文件不存在', 404);

    const body = await req.json().catch(() => ({}));
    const data: { displayName?: string | null; remark?: string | null; workOrderId?: string; categoryId?: string } = {};
    if (body.displayName !== undefined) data.displayName = clean(body.displayName, 160);
    if (body.remark !== undefined) data.remark = clean(body.remark, 500);
    if (typeof body.workOrderId === 'string' && body.workOrderId.trim() && body.workOrderId !== old.workOrderId) {
      const targetOrder = await prisma.workOrder.findFirst({ where: { id: body.workOrderId, deletedAt: null } });
      if (!targetOrder) return nativeError('目标工单不存在', 404);
      data.workOrderId = targetOrder.id;
    }
    if (typeof body.categoryId === 'string' && body.categoryId.trim() && body.categoryId !== old.categoryId) {
      const targetCategory = await prisma.resourceCategory.findUnique({ where: { id: body.categoryId } });
      if (!targetCategory) return nativeError('目标分类不存在', 404);
      data.categoryId = targetCategory.id;
    }
    if (!Object.keys(data).length) return nativeError('没有可更新字段', 400);

    const file = await prisma.resourceFile.update({
      where: { id: old.id },
      data,
      include: {
        uploadedBy: { select: { displayName: true, username: true } },
        workOrder: { select: { code: true } },
        category: { select: { name: true, code: true } },
      },
    });
    const action = old.workOrderId !== file.workOrderId || old.categoryId !== file.categoryId ? 'move_resource_file' : 'update_resource_file';
    await logOp({ userId: user.id, action, targetType: 'resource_file', targetId: file.id, detail: { fileName: file.displayName || file.originalName, client: 'harmony_native' } });
    await snapshotChange({
      entityType: 'resource_file',
      entityId: file.id,
      action,
      before: resourceFileSnapshot(old),
      after: resourceFileSnapshot(file),
      changedBy: user.displayName || user.username,
    });
    return nativeOk({ file: nativeFileDto(file) });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('文件信息保存失败', 500);
  }
}

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
