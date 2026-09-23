import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { requireUser, UnauthorizedError, ForbiddenError, unauthorized, forbidden } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';
import { libraryTaskWhere } from '@/lib/sample-library-query';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const photo = await prisma.samplePhoto.findFirst({ where: { id: params.id, deletedAt: null, task: libraryTaskWhere }, select: { objectKey: true, mimeType: true } });
    if (!photo) return NextResponse.json({ ok: false, error: '照片不存在或已移除' }, { status: 404 });
    const stream = await getObjectStream(photo.objectKey, { abortSignal: request.signal });
    const thumbnail = request.nextUrl.searchParams.get('size') === 'thumb';
    const headers = { 'Content-Type': thumbnail ? 'image/webp' : photo.mimeType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
    if (thumbnail) {
      const resized = stream.pipe(sharp({ limitInputPixels: 100_000_000 }).rotate().resize(440, 440, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 72 }));
      return new NextResponse(await resized.toBuffer(), { headers });
    }
    return new NextResponse(Readable.toWeb(stream) as unknown as BodyInit, { headers });
  } catch (error) { if (error instanceof UnauthorizedError) return unauthorized(); if (error instanceof ForbiddenError) return forbidden(); console.error('sample library photo', error); return NextResponse.json({ ok: false, error: '照片读取失败，请重试' }, { status: 500 }); }
}
