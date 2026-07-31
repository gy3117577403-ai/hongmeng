import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { SOP_WRITE_ACCESS, SopRequestError, assertMutableDraft } from '@/lib/sop';
import { prisma } from '@/lib/prisma';
import { deleteObjectsBestEffort, putObject } from '@/lib/s3';
import { fileType, safeFilename, validateFileContent } from '@/lib/validation';
import {
  createSopOperationLog,
  getOrCreateSopDocument,
  loadSopWorkspaceByItemId,
  lockSopScope,
  serializeSopAsset,
} from '@/lib/sop/server';
import { sopRouteError } from '@/lib/sop/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function datePart(date: Date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let uploadedKey: string | null = null;
  try {
    const user = await requireUser({ write: SOP_WRITE_ACCESS });
    const form = await req.formData();
    const upload = form.get('file');
    if (!(upload instanceof File)) throw new SopRequestError('请选择要插入的图片');
    const buffer = Buffer.from(await upload.arrayBuffer());
    const validationError = validateFileContent(upload.name, upload.type, upload.size, buffer);
    if (validationError) throw new SopRequestError(validationError);
    const detectedType = fileType(upload.name, upload.type);
    if (!['jpg', 'png', 'webp'].includes(detectedType)) throw new SopRequestError('SOP 正文仅支持 JPG、PNG、WEBP 图片');
    const mimeType = detectedType === 'jpg' ? 'image/jpeg' : `image/${detectedType}`;
    const objectKey = `sop-assets/${params.id}/${datePart(new Date())}/${crypto.randomUUID()}-${safeFilename(upload.name)}`;
    uploadedKey = objectKey;
    await putObject({ key: objectKey, body: buffer, contentType: mimeType, originalName: upload.name });

    const asset = await prisma.$transaction(async tx => {
      await lockSopScope(tx, params.id);
      const { document } = await getOrCreateSopDocument(tx, params.id, user.id);
      const versionId = typeof form.get('versionId') === 'string' ? String(form.get('versionId')).trim() : '';
      if (versionId) {
        const version = await tx.sopVersion.findFirst({ where: { id: versionId, documentId: document.id } });
        if (!version) throw new SopRequestError('SOP 草稿不存在或不属于当前产品', 404, 'SOP_VERSION_NOT_FOUND');
        assertMutableDraft(version);
      }
      const created = await tx.sopAsset.create({
        data: {
          documentId: document.id,
          originalName: upload.name,
          displayName: upload.name.slice(0, 160),
          mimeType,
          size: upload.size,
          objectKey,
          fileHash: crypto.createHash('sha256').update(buffer).digest('hex'),
          uploadedById: user.id,
        },
        include: { uploadedBy: { select: { id: true, username: true, displayName: true } } },
      });
      await tx.sopDocument.update({ where: { id: document.id }, data: { updatedById: user.id } });
      await createSopOperationLog(tx, {
        userId: user.id,
        action: 'upload_sop_asset',
        targetType: 'sop_asset',
        targetId: created.id,
        detail: { itemId: params.id, versionId: versionId || null, fileName: upload.name, fileSize: upload.size },
      });
      return created;
    });
    uploadedKey = null;
    const workspace = await loadSopWorkspaceByItemId(prisma, params.id);
    return NextResponse.json({ ok: true, asset: serializeSopAsset(asset), workspace });
  } catch (error) {
    if (uploadedKey) await deleteObjectsBestEffort([uploadedKey]);
    return sopRouteError(error, '上传 SOP 图片失败，请检查对象存储配置');
  }
}
