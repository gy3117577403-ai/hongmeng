import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { materialLibraryRouteError } from '@/lib/material-library-http';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const trash = url.searchParams.get('trash') === '1' && (user.laborRole === 'ADMIN' || user.access.capabilities.includes('QUALITY:DELETE'));
    const photo = await prisma.materialLibraryPhoto.findFirst({
      where: { id: params.id, ...(!trash ? { deletedAt: null } : {}), materialItem: { deletedAt: null } },
    });
    if (!photo) return NextResponse.json({ ok: false, error: '物料照片不存在或已删除' }, { status: 404 });
    const kind = url.searchParams.get('kind');
    const derivative = kind === 'thumbnail' && photo.thumbnailKey ? { key: photo.thumbnailKey, size: photo.thumbnailSize } : kind === 'preview' && photo.previewKey ? { key: photo.previewKey, size: photo.previewSize } : null;
    const etag = `"${photo.sha256}-${derivative ? kind : 'original'}-v1"`;
    const cache = { 'Cache-Control': 'private, no-cache, must-revalidate', ETag: etag, Vary: 'Cookie' };
    // Check login, deletion and parent state before returning a conditional hit.
    if (request.headers.get('if-none-match') === etag) return new NextResponse(null, { status: 304, headers: cache });
    const source = await getObjectStream(derivative?.key || photo.objectKey, { abortSignal: request.signal });
    const body = Readable.toWeb(source as unknown as Readable) as unknown as BodyInit;
    return new NextResponse(body, {
      headers: {
        'Content-Type': derivative ? 'image/webp' : photo.mimeType,
        'Content-Length': String(derivative?.size ?? photo.size),
        ...cache,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return materialLibraryRouteError(error, '物料照片读取失败');
  }
}
