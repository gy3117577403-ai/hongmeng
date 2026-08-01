import crypto from 'node:crypto';
import { requireUser } from '@/lib/auth';
import {
  PDF_OVERLAY_MAX_ASSET_BYTES,
  PdfOverlayRequestError,
  lockPdfOverlayScope,
  pdfOverlayRouteError,
} from '@/lib/pdf-overlay';
import { prisma } from '@/lib/prisma';
import { deleteObjectsBestEffort, putObject } from '@/lib/s3';
import { SOP_WRITE_ACCESS } from '@/lib/sop';
import { fileType, safeFilename, validateFileContent } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function ymd(date: Date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  let uploadedKey: string | null = null;
  try {
    const user = await requireUser({ write: SOP_WRITE_ACCESS });
    const { id: itemId } = await context.params;
    const form = await req.formData();
    const versionId = String(form.get('versionId') || '').trim();
    const upload = form.get('file');
    if (!versionId) throw new PdfOverlayRequestError('编辑草稿不存在，请重新打开在线编辑器');
    if (!(upload instanceof File)) throw new PdfOverlayRequestError('请选择要插入的图片');
    if (upload.size > PDF_OVERLAY_MAX_ASSET_BYTES) throw new PdfOverlayRequestError('单张图片不能超过 12MB');

    const body = Buffer.from(await upload.arrayBuffer());
    const validationError = validateFileContent(upload.name, upload.type, upload.size, body);
    if (validationError) throw new PdfOverlayRequestError(validationError);
    const detectedType = fileType(upload.name, upload.type);
    if (!['jpg', 'png', 'webp'].includes(detectedType)) {
      throw new PdfOverlayRequestError('在线编辑仅支持 JPG、PNG、WEBP 图片');
    }
    const mimeType = detectedType === 'jpg' ? 'image/jpeg' : `image/${detectedType}`;

    const version = await prisma.pdfOverlayVersion.findFirst({
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
      select: { id: true, documentId: true },
    });
    if (!version) throw new PdfOverlayRequestError('编辑草稿不存在或已经发布', 404, 'PDF_OVERLAY_DRAFT_NOT_FOUND');

    const objectKey = `pdf-overlay-assets/${itemId}/${ymd(new Date())}/${crypto.randomUUID()}-${safeFilename(upload.name)}`;
    uploadedKey = objectKey;
    await putObject({ key: objectKey, body, contentType: mimeType, originalName: upload.name });

    const asset = await prisma.$transaction(async tx => {
      await lockPdfOverlayScope(tx, version.documentId);
      const activeDraft = await tx.pdfOverlayVersion.findFirst({
        where: { id: version.id, documentId: version.documentId, status: 'draft', deletedAt: null },
        select: { id: true },
      });
      if (!activeDraft) throw new PdfOverlayRequestError('编辑草稿状态已变化，请刷新后重试', 409, 'PDF_OVERLAY_DRAFT_CHANGED');
      const created = await tx.pdfOverlayAsset.create({
        data: {
          documentId: version.documentId,
          originalName: upload.name,
          displayName: upload.name.slice(0, 160),
          mimeType,
          size: upload.size,
          objectKey,
          fileHash: crypto.createHash('sha256').update(body).digest('hex'),
          uploadedById: user.id,
        },
      });
      await tx.pdfOverlayDocument.update({
        where: { id: version.documentId },
        data: { updatedById: user.id },
      });
      await tx.operationLog.create({
        data: {
          userId: user.id,
          action: 'upload_pdf_overlay_asset',
          targetType: 'pdf_overlay_asset',
          targetId: created.id,
          detail: { itemId, versionId, fileName: upload.name, fileSize: upload.size },
        },
      });
      return created;
    });

    uploadedKey = null;
    return Response.json({
      ok: true,
      assetId: asset.id,
      url: `/api/drawing-library/sop-pdf-overlay-assets/${asset.id}`,
    });
  } catch (error) {
    if (uploadedKey) await deleteObjectsBestEffort([uploadedKey]);
    return pdfOverlayRouteError(error, '上传编辑图片失败');
  }
}
