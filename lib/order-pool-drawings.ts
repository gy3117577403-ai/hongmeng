import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { findDrawingProductCandidates, DrawingLibraryResolutionError } from './drawing-library-resolution';
import { matchImportDrawing, type ImportDrawingArchive } from './import-drawing-association';

export type PoolDrawingMatch = ReturnType<typeof matchImportDrawing>;
export class PoolDrawingError extends DrawingLibraryResolutionError {
  constructor(error: DrawingLibraryResolutionError, public line?: number) {
    super(error.message, error.code, error.itemIds);
  }
}

/** Pool orders select a product archive, never an old execution order. */
export async function matchPoolDrawing(input: {
  customerName: string; specification: string; drawingLibraryItemId?: string | null; libraryKey?: string;
}, db: Pick<Prisma.TransactionClient, '$queryRaw' | 'drawingLibraryItem'> = prisma): Promise<PoolDrawingMatch> {
  const candidates = await findDrawingProductCandidates(db, input);
  const selected = input.drawingLibraryItemId || input.libraryKey || '';
  const ids = candidates.map(item => item.id);
  const records = await db.drawingLibraryItem.findMany({
    where: { OR: [{ id: { in: ids } }, ...(selected ? [{ id: selected }, { libraryKey: selected }] : [])] },
    select: {
      id: true, libraryKey: true, customerName: true, customerCode: true, specification: true,
      productName: true, deletedAt: true, updatedAt: true,
      files: { where: { deletedAt: null, isCurrent: true, category: { code: { in: ['drawing', 'sop'] } } },
        orderBy: { createdAt: 'desc' }, select: { id: true, originalName: true, displayName: true, mimeType: true, version: true, category: { select: { code: true } } } },
    }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
  });
  const items: ImportDrawingArchive[] = records.map(item => ({
    ...item, deletedAt: item.deletedAt?.toISOString() || null, updatedAt: item.updatedAt.toISOString(),
    drawingFileCount: item.files.filter(file => file.category.code === 'drawing').length,
    sopFileCount: item.files.filter(file => file.category.code === 'sop').length,
    files: item.files.map(file => ({ id: file.id, name: file.displayName || file.originalName,
      mimeType: file.mimeType, version: file.version || 'V1.0', category: file.category.code })),
  }));
  return matchImportDrawing({ ...input, libraryKey: selected || undefined }, items);
}
