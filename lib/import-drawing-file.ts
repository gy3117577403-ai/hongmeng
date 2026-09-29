import { prisma } from '@/lib/prisma';

// Import previews expose current drawing/SOP files, never removed archive files.
export async function isImportDrawingFile(fileId: string) {
  return !!await prisma.drawingLibraryFile.findFirst({
    where: { id: fileId, deletedAt: null, isCurrent: true, libraryItem: { deletedAt: null }, category: { code: { in: ['drawing', 'sop'] } } },
    select: { id: true },
  });
}
