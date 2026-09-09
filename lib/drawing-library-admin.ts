import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { getDrawingLibraryReferenceImpact, refreshRestoredDrawingWorkOrders } from './drawing-library-lifecycle';
import { DrawingLibraryResolutionError, findDrawingProductCandidates, lockDrawingProduct } from './drawing-library-resolution';

export async function changeDrawingLibraryLifecycle(id: string, actorId: string, action: 'delete' | 'restore', reason: string) {
  if (!reason.trim() || reason.length > 500) throw new DrawingLibraryResolutionError('请填写 1 至 500 字的操作原因', 'DRAWING_LIBRARY_REASON_REQUIRED');
  return prisma.$transaction(async tx => {
    const initial = await tx.drawingLibraryItem.findUnique({ where: { id } });
    if (!initial) throw new DrawingLibraryResolutionError('图纸档案不存在', 'DRAWING_LIBRARY_NOT_FOUND');
    await lockDrawingProduct(tx, initial);
    await tx.$queryRaw`SELECT id FROM drawing_library_items WHERE id = ${id} FOR UPDATE`;
    const item = (await tx.drawingLibraryItem.findUnique({ where: { id } }))!;
    if ((action === 'delete') === Boolean(item.deletedAt)) return { itemId: id, unchanged: true };
    const impact = await getDrawingLibraryReferenceImpact(tx, id);
    if (action === 'delete' && impact.blocked) throw new DrawingLibraryResolutionError(impact.blockers.join('；'), 'DRAWING_LIBRARY_IN_USE');
    if (action === 'restore') {
      const conflicts = (await findDrawingProductCandidates(tx, item)).filter(candidate => candidate.id !== id && !candidate.deletedAt);
      if (conflicts.length) throw new DrawingLibraryResolutionError('已有同客户同型号的活动档案，请先核对重复关联，不能直接恢复形成重复档案', 'DRAWING_LIBRARY_RESTORE_CONFLICT', conflicts.map(candidate => candidate.id));
    }
    const deletedAt = action === 'delete' ? new Date() : null;
    await tx.drawingLibraryItem.update({ where: { id }, data: { deletedAt } });
    // Restoring a master never restores its deleted files or reassigns orders.
    const refreshedWorkOrders = action === 'restore' ? await refreshRestoredDrawingWorkOrders(tx, id) : 0;
    await tx.operationLog.create({ data: {
      userId: actorId, action: `${action}_drawing_library_item`, targetType: 'drawing_library_item', targetId: id,
      detail: { reason: reason.trim(), libraryKey: item.libraryKey, before: { deletedAt: item.deletedAt?.toISOString() || null }, after: { deletedAt: deletedAt?.toISOString() || null }, impact, refreshedWorkOrders } as Prisma.InputJsonValue,
    } });
    return { itemId: id, unchanged: false, impact, refreshedWorkOrders };
  }, { timeout: 15000 });
}
