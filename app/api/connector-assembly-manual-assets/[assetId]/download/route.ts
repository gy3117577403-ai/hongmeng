import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { signedUrl } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { assetId: string } }) {
  try {
    const user = await requireUser();
    const asset = await prisma.connectorAssemblyManualAsset.findFirst({
      where: { id: params.assetId, deletedAt: null, version: { deletedAt: null, manual: { deletedAt: null } } },
      include: { version: { select: { manualId: true, revision: true } } },
    });
    if (!asset) return NextResponse.json({ ok: false, error: '说明书文件不存在或已删除' }, { status: 404 });
    await logOp({ userId: user.id, action: 'download_connector_assembly_manual', targetType: 'connector_assembly_manual_asset', targetId: asset.id, detail: { manualId: asset.version.manualId, revision: asset.version.revision } });
    return NextResponse.redirect(await signedUrl({ key: asset.objectKey, filename: asset.displayName?.trim() || asset.originalName, disposition: 'attachment', contentType: asset.mimeType }));
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '说明书文件下载失败' }, { status: 500 });
  }
}
