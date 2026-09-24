import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { requireUser, UnauthorizedError, ForbiddenError, unauthorized, forbidden } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';
import { libraryTaskWhere } from '@/lib/sample-library-query';
import { samplePhotoPreview, SamplePreviewBusyError } from '@/lib/sample-photo-preview';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    // Recheck access and deletion even when the derivative is cached.
    const photo = await prisma.samplePhoto.findFirst({ where: { id: params.id, deletedAt: null, task: libraryTaskWhere }, select: { objectKey: true, mimeType: true, sha256: true, version: true } });
    if (!photo) return NextResponse.json({ ok: false, error: '照片不存在或已移除', code: 'PHOTO_NOT_FOUND' }, { status: 404 });
    const size = request.nextUrl.searchParams.get('size');
    const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
    if (size === 'original') {
      const stream = await getObjectStream(photo.objectKey, { abortSignal: request.signal });
      return new NextResponse(Readable.toWeb(stream) as unknown as BodyInit, { headers: { ...headers, 'Content-Type': photo.mimeType } });
    }
    const variant = size === 'thumb' ? 'thumb' : size === 'hd' ? 'hd' : 'screen';
    const bytes = await samplePhotoPreview(photo.objectKey + ':' + photo.sha256 + ':' + photo.version, variant,
      () => getObjectStream(photo.objectKey, { abortSignal: AbortSignal.timeout(25_000) }));
    return new NextResponse(new Uint8Array(bytes), { headers: { ...headers, 'Content-Type': variant === 'thumb' ? 'image/webp' : 'image/jpeg', 'X-Photo-Preview': variant } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden();
    const name = error instanceof Error ? error.name : '';
    const missing = name === 'NoSuchKey' || name === 'NotFound';
    const busy = error instanceof SamplePreviewBusyError;
    console.error('sample library preview', { photoId: params.id, errorName: name });
    return NextResponse.json({ ok: false, error: missing ? '照片文件已移除' : busy ? '预览繁忙，请稍后重试' : '照片暂时无法读取，请重试或查看原图', code: missing ? 'PHOTO_NOT_FOUND' : busy ? 'PHOTO_BUSY' : 'PHOTO_PREVIEW_FAILED' }, { status: missing ? 404 : busy ? 503 : 422 });
  }
}
