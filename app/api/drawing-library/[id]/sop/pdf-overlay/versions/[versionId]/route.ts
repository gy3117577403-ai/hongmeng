import type { Prisma } from '@prisma/client';
import { requireUser } from '@/lib/auth';
import { PdfOverlayRequestError, pdfOverlayRouteError, validatePdfOverlayDocument } from '@/lib/pdf-overlay';
import { prisma } from '@/lib/prisma';
import { SOP_WRITE_ACCESS } from '@/lib/sop';

export async function PATCH(req: Request, context: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    const user = await requireUser({ write: SOP_WRITE_ACCESS });
    const { id: itemId, versionId } = await context.params;
    const payload = await req.json().catch(() => null) as { expectedRevision?: number; document?: unknown } | null;
    const expectedRevision = payload?.expectedRevision;
    if (!Number.isInteger(expectedRevision) || (expectedRevision ?? -1) < 0) throw new PdfOverlayRequestError('草稿版本号无效');
    const version = await prisma.pdfOverlayVersion.findFirst({
      where: { id: versionId, status: 'draft', deletedAt: null, document: { drawingLibraryItemId: itemId, deletedAt: null, drawingLibraryItem: { deletedAt: null } } },
      select: { id: true, documentId: true, sourceFileId: true, sourcePageCount: true },
    });
    if (!version) throw new PdfOverlayRequestError('编辑草稿不存在或已发布', 404, 'PDF_OVERLAY_DRAFT_NOT_FOUND');
    const document = validatePdfOverlayDocument(payload?.document, { itemId, fileId: version.sourceFileId, pageCount: version.sourcePageCount });
    document.revision = (expectedRevision as number) + 1;
    const updated = await prisma.pdfOverlayVersion.updateMany({ where: { id: version.id, revision: expectedRevision as number, status: 'draft', deletedAt: null }, data: { content: document as unknown as Prisma.InputJsonValue, revision: { increment: 1 }, updatedById: user.id } });
    if (updated.count !== 1) throw new PdfOverlayRequestError('草稿已被其他人更新，请刷新后重试', 409, 'PDF_OVERLAY_REVISION_CONFLICT');
    await prisma.pdfOverlayDocument.update({ where: { id: version.documentId }, data: { updatedById: user.id } });
    return Response.json({ ok: true, revision: (expectedRevision as number) + 1, updatedAt: new Date().toISOString() });
  } catch (error) {
    return pdfOverlayRouteError(error, '保存 PDF 编辑草稿失败');
  }
}
