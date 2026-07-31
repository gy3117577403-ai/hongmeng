import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { requireUser } from '@/lib/auth';
import { collectSopAssetIds, SOP_WRITE_ACCESS, SopRequestError } from '@/lib/sop';
import { prisma } from '@/lib/prisma';
import { getObjectStream, signedUrl } from '@/lib/s3';
import { createSopOperationLog, loadSopWorkspaceByItemId, lockSopScope, serializeSopAsset } from '@/lib/sop/server';
import { sopRouteError } from '@/lib/sop/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { assetId: string } }) {
  try {
    await requireUser();
    const asset = await prisma.sopAsset.findFirst({
      where: { id: params.assetId, deletedAt: null, document: { deletedAt: null, drawingLibraryItem: { deletedAt: null } } },
      include: { uploadedBy: { select: { id: true, username: true, displayName: true } } },
    });
    if (!asset) throw new SopRequestError('SOP 图片不存在或已删除', 404, 'SOP_ASSET_NOT_FOUND');
    if (req.nextUrl.searchParams.get('json') === '1') {
      const url = await signedUrl({ key: asset.objectKey, filename: asset.originalName, disposition: 'inline', contentType: asset.mimeType });
      return NextResponse.json({ ok: true, asset: serializeSopAsset(asset), url });
    }

    // Keep the editor and its PDF export on the same origin. Redirecting the
    // image to S3 can taint html2canvas when the bucket has no browser CORS rule.
    const stream = await getObjectStream(asset.objectKey);
    const body = Readable.toWeb(stream as unknown as Readable) as unknown as BodyInit;
    return new Response(body, {
      headers: {
        'Content-Type': asset.mimeType,
        'Content-Length': String(asset.size),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(asset.originalName)}`,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return sopRouteError(error, '读取 SOP 图片失败');
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { assetId: string } }) {
  try {
    const user = await requireUser({ write: SOP_WRITE_ACCESS });
    const itemId = await prisma.$transaction(async tx => {
      const asset = await tx.sopAsset.findFirst({
        where: { id: params.assetId, deletedAt: null, document: { deletedAt: null, drawingLibraryItem: { deletedAt: null } } },
        include: { document: { select: { id: true, drawingLibraryItemId: true } } },
      });
      if (!asset) throw new SopRequestError('SOP 图片不存在或已删除', 404, 'SOP_ASSET_NOT_FOUND');
      await lockSopScope(tx, asset.document.drawingLibraryItemId);
      const versions = await tx.sopVersion.findMany({
        where: { documentId: asset.documentId, deletedAt: null },
        select: { id: true, status: true, content: true },
      });
      const referencedBy = versions
        .filter(version => collectSopAssetIds(version.content).includes(asset.id))
        .map(version => ({ id: version.id, status: version.status }));
      if (referencedBy.length) {
        throw new SopRequestError('该图片仍被 SOP 版本引用，请先从草稿正文移除；已发布历史引用不可破坏', 409, 'SOP_ASSET_IN_USE', { versions: referencedBy });
      }
      const changed = await tx.sopAsset.updateMany({ where: { id: asset.id, deletedAt: null }, data: { deletedAt: new Date() } });
      if (changed.count !== 1) throw new SopRequestError('SOP 图片已被其他人删除', 409, 'SOP_ASSET_DELETE_CONFLICT');
      await tx.sopDocument.update({ where: { id: asset.documentId }, data: { updatedById: user.id } });
      await createSopOperationLog(tx, {
        userId: user.id,
        action: 'delete_sop_asset',
        targetType: 'sop_asset',
        targetId: asset.id,
        detail: { itemId: asset.document.drawingLibraryItemId, objectKey: asset.objectKey },
      });
      return asset.document.drawingLibraryItemId;
    });
    const workspace = await loadSopWorkspaceByItemId(prisma, itemId);
    return NextResponse.json({ ok: true, workspace });
  } catch (error) {
    return sopRouteError(error, '删除 SOP 图片失败');
  }
}
