import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { materialLibraryItemLockKey, MaterialLibraryError } from '@/lib/material-library';

export async function manageMaterialPhotos(input: {
  materialItemId: string; ids: string[]; action: 'DELETE' | 'RESTORE'; reason: string;
  actor: { id: string; name: string }; canDeleteArchived: boolean;
  expectedUpdatedAt?: Record<string, string>;
}) {
  const ids = [...new Set(input.ids)];
  if (!ids.length || ids.length > 100 || ids.some(id => typeof id !== 'string' || id.length > 80)) throw new MaterialLibraryError('请选择 1–100 张照片', 400);
  if (input.action === 'RESTORE' && !input.canDeleteArchived) throw new MaterialLibraryError('没有恢复照片的权限', 403);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${materialLibraryItemLockKey(input.materialItemId)}))`;
    const item = await tx.materialLibraryItem.findFirst({ where: { id: input.materialItemId, deletedAt: null }, select: { id: true } });
    if (!item) throw new MaterialLibraryError('请先恢复物料档案，再管理照片', 409);
    const photos = await tx.materialLibraryPhoto.findMany({ where: { id: { in: ids }, materialItemId: item.id }, include: { session: { select: { status: true } } } });
    if (photos.length !== ids.length) throw new MaterialLibraryError('照片归属已变化，请刷新后重试', 409);
    const changed = photos.filter(photo => input.action === 'DELETE' ? !photo.deletedAt : Boolean(photo.deletedAt));
    for (const photo of changed) {
      if (photo.session.status !== 'ACTIVE' && !input.canDeleteArchived) throw new MaterialLibraryError('已归档照片需要照片删除权限', 403);
      const expected = input.expectedUpdatedAt?.[photo.id];
      if (expected && new Date(expected).getTime() !== photo.updatedAt.getTime()) throw new MaterialLibraryError('照片已被其他人修改，请刷新后重试', 409);
    }
    if (changed.length) {
      await tx.materialLibraryPhoto.updateMany({ where: { id: { in: changed.map(photo => photo.id) } }, data: input.action === 'DELETE'
        ? { deletedAt: new Date(), deletedByName: input.actor.name, deletedReason: input.reason.slice(0, 500) || '上传错误', isCover: false }
        : { deletedAt: null, deletedByName: null, deletedReason: null, isCover: false } });
      const cover = await tx.materialLibraryPhoto.findFirst({ where: { materialItemId: item.id, deletedAt: null, isCover: true }, select: { id: true } });
      if (!cover) {
        const replacement = await tx.materialLibraryPhoto.findFirst({ where: { materialItemId: item.id, deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true } });
        if (replacement) await tx.materialLibraryPhoto.update({ where: { id: replacement.id }, data: { isCover: true } });
      }
      await tx.materialLibraryItem.update({ where: { id: item.id }, data: { updatedAt: new Date(), version: { increment: 1 } } });
      await tx.operationLog.create({ data: {
        userId: input.actor.id, action: input.action === 'DELETE' ? 'delete_material_library_photo' : 'restore_material_library_photo',
        targetType: 'material_library_item', targetId: item.id,
        detail: { photoIds: changed.map(photo => photo.id), sessionIds: [...new Set(changed.map(photo => photo.sessionId))], reason: input.reason, softDelete: true, objectRetained: true },
      } });
    }
    return { changed: changed.length, sessionIds: [...new Set(photos.map(photo => photo.sessionId))] };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
