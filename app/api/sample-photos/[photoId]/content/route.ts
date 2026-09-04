import { NextResponse } from 'next/server';
import { Readable } from 'stream';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { photoId: string } }) {
  try {
    await requireUser();
    const photo = await prisma.samplePhoto.findFirst({
      where: { id: params.photoId, deletedAt: null, task: { deletedAt: null } },
      select: { objectKey: true, mimeType: true, size: true },
    });
    if (!photo) return NextResponse.json({ ok: false, error: '照片不存在' }, { status: 404 });
    const stream = await getObjectStream(photo.objectKey);
    const body = Readable.toWeb(stream as unknown as Readable) as unknown as BodyInit;
    return new NextResponse(body, {
      headers: {
        'Content-Type': photo.mimeType,
        'Content-Length': String(photo.size),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('sample photo content failed', error);
    return NextResponse.json({ ok: false, error: '照片读取失败' }, { status: 500 });
  }
}
