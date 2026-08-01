import type { Prisma } from '@prisma/client';
import { requireUser } from '@/lib/auth';
import { serializeDrawingLibraryFile } from '@/lib/drawing-library';
import { emptyPdfOverlayDocument, loadEditablePdfSource, pdfOverlayRouteError, PdfOverlayRequestError } from '@/lib/pdf-overlay';
import { prisma } from '@/lib/prisma';
import { SOP_WRITE_ACCESS } from '@/lib/sop';

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser({ write: SOP_WRITE_ACCESS });
    const { id: itemId } = await context.params;
    const body = await req.json().catch(() => ({})) as { baseFileId?: string };
    const baseFileId = body.baseFileId?.trim() || '';
    if (!baseFileId) throw new PdfOverlayRequestError('请选择要编辑的 SOP PDF');
    const source = await loadEditablePdfSource(itemId, baseFileId);
    const result = await prisma.$transaction(async tx => {
      let document = await tx.pdfOverlayDocument.findFirst({
        where: { drawingLibraryItemId: itemId, currentFileId: source.file.id, deletedAt: null },
        include: { versions: { where: { status: 'draft', deletedAt: null }, orderBy: { version: 'desc' }, take: 1 } },
      });
      const freshContent = () => emptyPdfOverlayDocument({ itemId, fileId: source.file.id, fileName: source.file.displayName || source.file.originalName, pageCount: source.pageCount });
      if (!document) {
        document = await tx.pdfOverlayDocument.create({
          data: {
            drawingLibraryItemId: itemId, baseFileId: source.file.id, currentFileId: source.file.id,
            title: `${source.file.displayName || source.file.originalName} 在线批注`, createdById: user.id, updatedById: user.id,
            versions: { create: { sourceFileId: source.file.id, sourceSha256: source.hash, sourcePageCount: source.pageCount, sourceSize: source.body.length, sourceUpdatedAt: source.file.updatedAt, version: 1, revision: 0, status: 'draft', title: `${source.file.displayName || source.file.originalName} 编辑草稿`, content: freshContent() as unknown as Prisma.InputJsonValue, createdById: user.id, updatedById: user.id } },
          },
          include: { versions: { where: { status: 'draft', deletedAt: null }, orderBy: { version: 'desc' }, take: 1 } },
        });
      } else if (!document.versions[0]) {
        const max = await tx.pdfOverlayVersion.aggregate({ where: { documentId: document.id }, _max: { version: true } });
        const draft = await tx.pdfOverlayVersion.create({ data: { documentId: document.id, sourceFileId: source.file.id, sourceSha256: source.hash, sourcePageCount: source.pageCount, sourceSize: source.body.length, sourceUpdatedAt: source.file.updatedAt, version: (max._max.version || 0) + 1, revision: 0, status: 'draft', title: `${source.file.displayName || source.file.originalName} 编辑草稿`, content: freshContent() as unknown as Prisma.InputJsonValue, basedOnVersionId: document.currentPublishedVersionId, createdById: user.id, updatedById: user.id } });
        document.versions = [draft];
      }
      const draft = document.versions[0]!;
      if (draft.sourceFileId !== source.file.id || draft.sourceSha256 !== source.hash || draft.sourceSize !== source.body.length || draft.sourcePageCount !== source.pageCount) {
        throw new PdfOverlayRequestError('PDF 已被替换，请关闭编辑器后重新打开', 409, 'PDF_OVERLAY_SOURCE_CHANGED');
      }
      return { document, draft };
    });
    return Response.json({ ok: true, documentId: result.document.id, versionId: result.draft.id, revision: result.draft.revision, content: result.draft.content, sourceFile: serializeDrawingLibraryFile(source.file) });
  } catch (error) {
    return pdfOverlayRouteError(error, '打开 PDF 在线编辑失败');
  }
}
