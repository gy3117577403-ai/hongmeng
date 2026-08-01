import { Readable } from 'node:stream';
import { requireUser } from '@/lib/auth';
import { PdfOverlayRequestError, pdfOverlayRouteError } from '@/lib/pdf-overlay';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, context: { params: Promise<{ assetId: string }> }) {
  try {
    await requireUser();
    const { assetId } = await context.params;
    const asset = await prisma.pdfOverlayAsset.findFirst({
      where: {
        id: assetId,
        deletedAt: null,
        document: {
          deletedAt: null,
          drawingLibraryItem: { deletedAt: null },
        },
      },
    });
    if (!asset) throw new PdfOverlayRequestError('编辑图片不存在或已删除', 404, 'PDF_OVERLAY_ASSET_NOT_FOUND');
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
    return pdfOverlayRouteError(error, '读取编辑图片失败');
  }
}
