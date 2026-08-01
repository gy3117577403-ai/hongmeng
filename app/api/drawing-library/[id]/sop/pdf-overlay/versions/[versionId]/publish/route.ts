import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';
import { requireUser } from '@/lib/auth';
import { serializeDrawingLibraryFile } from '@/lib/drawing-library';
import { synchronizeDrawingLibraryWorkOrderStatus } from '@/lib/drawing-library-lifecycle';
import {
  PdfOverlayRequestError,
  loadEditablePdfSource,
  lockPdfOverlayScope,
  pdfOverlayRouteError,
  validatePdfOverlayDocument,
} from '@/lib/pdf-overlay';
import { reconcileProductionPlanDrawingLinks } from '@/lib/planning-product-link';
import { prisma } from '@/lib/prisma';
import { deleteObjectsBestEffort, putObject } from '@/lib/s3';
import { nextDrawingLibraryMinorVersion, SOP_WRITE_ACCESS } from '@/lib/sop';
import { safeFilename } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type OverlayManifestEntry = {
  page: number;
  width: number;
  height: number;
  field: string;
};

function ymd(date: Date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

function parseNonNegativeInteger(value: FormDataEntryValue | null, label: string) {
  const parsed = typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0) throw new PdfOverlayRequestError(`${label}无效`);
  return parsed;
}

function parseManifest(value: FormDataEntryValue | null, pageCount: number): OverlayManifestEntry[] {
  if (typeof value !== 'string') throw new PdfOverlayRequestError('缺少 PDF 批注页清单');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new PdfOverlayRequestError('PDF 批注页清单格式无效');
  }
  if (!Array.isArray(parsed) || parsed.length > pageCount) throw new PdfOverlayRequestError('PDF 批注页清单数量无效');
  const seen = new Set<number>();
  return parsed.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PdfOverlayRequestError(`第 ${index + 1} 个批注页无效`);
    const entry = raw as Record<string, unknown>;
    const page = Number(entry.page);
    const width = Number(entry.width);
    const height = Number(entry.height);
    const field = typeof entry.field === 'string' ? entry.field : '';
    if (!Number.isInteger(page) || page < 1 || page > pageCount || seen.has(page)) throw new PdfOverlayRequestError('批注页码无效或重复');
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) throw new PdfOverlayRequestError('批注页尺寸无效');
    if (!/^overlay_[1-9]\d*$/.test(field)) throw new PdfOverlayRequestError('批注文件字段无效');
    seen.add(page);
    return { page, width, height, field };
  });
}

function publishedName(sourceName: string, version: number) {
  const stem = sourceName.replace(/\.pdf$/i, '').slice(0, 120) || 'SOP';
  return `${stem}-在线修订V${version}.pdf`;
}

export async function POST(req: Request, context: { params: Promise<{ id: string; versionId: string }> }) {
  let uploadedKey: string | null = null;
  try {
    const user = await requireUser({ write: SOP_WRITE_ACCESS });
    const { id: itemId, versionId } = await context.params;
    const form = await req.formData();
    const expectedRevision = parseNonNegativeInteger(form.get('expectedRevision'), '草稿版本号');

    const draft = await prisma.pdfOverlayVersion.findFirst({
      where: {
        id: versionId,
        status: 'draft',
        deletedAt: null,
        document: {
          drawingLibraryItemId: itemId,
          deletedAt: null,
          drawingLibraryItem: { deletedAt: null },
        },
      },
      include: {
        document: { select: { id: true, currentFileId: true } },
      },
    });
    if (!draft) throw new PdfOverlayRequestError('编辑草稿不存在或已经发布', 404, 'PDF_OVERLAY_DRAFT_NOT_FOUND');
    if (draft.revision !== expectedRevision) throw new PdfOverlayRequestError('草稿已被其他人更新，请刷新后重试', 409, 'PDF_OVERLAY_REVISION_CONFLICT');
    if (draft.document.currentFileId !== draft.sourceFileId) throw new PdfOverlayRequestError('当前 PDF 已产生新版本，请重新打开编辑器', 409, 'PDF_OVERLAY_SOURCE_CHANGED');

    let documentInput: unknown;
    try {
      documentInput = JSON.parse(String(form.get('document') || ''));
    } catch {
      throw new PdfOverlayRequestError('编辑草稿格式无效');
    }
    const source = await loadEditablePdfSource(itemId, draft.sourceFileId);
    if (
      draft.sourceSha256 !== source.hash
      || draft.sourceSize !== source.body.length
      || draft.sourcePageCount !== source.pageCount
    ) {
      throw new PdfOverlayRequestError('原 PDF 内容已变化，请关闭编辑器后重新打开', 409, 'PDF_OVERLAY_SOURCE_CHANGED');
    }
    const document = validatePdfOverlayDocument(documentInput, {
      itemId,
      fileId: source.file.id,
      pageCount: source.pageCount,
    });
    const manifest = parseManifest(form.get('manifest'), source.pageCount);

    const pdf = await PDFDocument.load(source.body, { ignoreEncryption: false, updateMetadata: false });
    for (const entry of manifest) {
      const upload = form.get(entry.field);
      if (!(upload instanceof File) || upload.type !== 'image/png') throw new PdfOverlayRequestError(`第 ${entry.page} 页批注图层缺失`);
      if (upload.size > 20 * 1024 * 1024) throw new PdfOverlayRequestError(`第 ${entry.page} 页批注图层过大`);
      const png = await pdf.embedPng(Buffer.from(await upload.arrayBuffer()));
      const page = pdf.getPage(entry.page - 1);
      page.drawImage(png, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
    }
    pdf.setModificationDate(new Date());
    pdf.setProducer('杭连电子协同平台 PDF 在线编辑器');
    const publishedBody = Buffer.from(await pdf.save({ useObjectStreams: true }));
    const outputName = publishedName(source.file.displayName || source.file.originalName, draft.version);
    const objectKey = `drawing-library/${itemId}/sop/${ymd(new Date())}/${crypto.randomUUID()}-${safeFilename(outputName)}`;
    uploadedKey = objectKey;
    await putObject({ key: objectKey, body: publishedBody, contentType: 'application/pdf', originalName: outputName });

    const result = await prisma.$transaction(async tx => {
      await lockPdfOverlayScope(tx, draft.document.id);
      const lockedDraft = await tx.pdfOverlayVersion.findFirst({
        where: { id: draft.id, documentId: draft.document.id, status: 'draft', deletedAt: null },
        include: {
          document: { select: { currentFileId: true, drawingLibraryItemId: true } },
          sourceFile: { include: { category: true } },
        },
      });
      if (!lockedDraft) throw new PdfOverlayRequestError('编辑草稿状态已变化，请刷新后重试', 409, 'PDF_OVERLAY_DRAFT_CHANGED');
      if (lockedDraft.revision !== expectedRevision) throw new PdfOverlayRequestError('草稿已被其他人更新，请刷新后重试', 409, 'PDF_OVERLAY_REVISION_CONFLICT');
      if (
        lockedDraft.document.currentFileId !== lockedDraft.sourceFileId
        || lockedDraft.sourceFile.deletedAt
        || !lockedDraft.sourceFile.isCurrent
      ) {
        throw new PdfOverlayRequestError('当前 PDF 已产生新版本，请重新打开编辑器', 409, 'PDF_OVERLAY_SOURCE_CHANGED');
      }

      const existingVersions = await tx.drawingLibraryFile.findMany({
        where: { libraryItemId: itemId, categoryId: lockedDraft.sourceFile.categoryId },
        select: { version: true },
      });
      const version = nextDrawingLibraryMinorVersion(existingVersions.map(file => file.version));
      const nextRevision = expectedRevision + 1;
      document.revision = nextRevision;
      document.updatedAt = new Date().toISOString();

      await tx.drawingLibraryFile.update({
        where: { id: lockedDraft.sourceFileId },
        data: { isCurrent: false },
      });
      const created = await tx.drawingLibraryFile.create({
        data: {
          libraryItemId: itemId,
          categoryId: lockedDraft.sourceFile.categoryId,
          originalName: outputName,
          displayName: outputName,
          mimeType: 'application/pdf',
          size: publishedBody.length,
          objectKey,
          version,
          uploadedById: user.id,
          sourcePdfOverlayVersionId: lockedDraft.id,
          supersedesFileId: lockedDraft.sourceFileId,
          isCurrent: true,
          remark: `在线编辑发布，基于 ${lockedDraft.sourceFile.version}`,
        },
        include: {
          category: { select: { id: true, name: true, code: true, sortOrder: true } },
          uploadedBy: { select: { displayName: true, username: true } },
        },
      });
      await tx.pdfOverlayVersion.update({
        where: { id: lockedDraft.id },
        data: {
          status: 'published',
          content: document as unknown as Prisma.InputJsonValue,
          revision: nextRevision,
          updatedById: user.id,
          publishedById: user.id,
          publishedAt: new Date(),
        },
      });
      await tx.pdfOverlayDocument.update({
        where: { id: draft.document.id },
        data: {
          currentFileId: created.id,
          currentPublishedVersionId: lockedDraft.id,
          updatedById: user.id,
        },
      });
      await tx.drawingLibraryItem.update({ where: { id: itemId }, data: { updatedAt: new Date() } });
      const planning = await reconcileProductionPlanDrawingLinks(tx, { drawingLibraryItemId: itemId });
      const sync = await synchronizeDrawingLibraryWorkOrderStatus(tx, itemId);
      await tx.operationLog.create({
        data: {
          userId: user.id,
          action: 'publish_pdf_overlay_version',
          targetType: 'drawing_library_file',
          targetId: created.id,
          detail: {
            itemId,
            documentId: draft.document.id,
            overlayVersionId: lockedDraft.id,
            sourceFileId: lockedDraft.sourceFileId,
            outputFileId: created.id,
            version,
            annotationCount: document.annotations.length,
            overlayPages: manifest.map(entry => entry.page),
            planning,
            sync,
          },
        },
      });
      return { file: created, revision: nextRevision, planning, sync };
    });

    uploadedKey = null;
    return Response.json({
      ok: true,
      file: serializeDrawingLibraryFile(result.file),
      revision: result.revision,
      updatedAt: document.updatedAt,
      planning: result.planning,
      sync: result.sync,
    });
  } catch (error) {
    if (uploadedKey) await deleteObjectsBestEffort([uploadedKey]);
    return pdfOverlayRouteError(error, '发布 PDF 新版本失败');
  }
}
