import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { materialLibraryRouteError } from '@/lib/material-library-http';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const photo = await prisma.materialLibraryPhoto.findFirst({
      where: { id: params.id, deletedAt: null },
      select: { objectKey: true, mimeType: true, size: true },
    });
    if (!photo) return NextResponse.json({ ok: false, error: '物料照片不存在或已删除' }, { status: 404 });
    const source = await getObjectStream(photo.objectKey);
    const body = Readable.toWeb(source as unknown as Readable) as unknown as BodyInit;
    return new NextResponse(body, {
      headers: {
        'Content-Type': photo.mimeType,
        'Content-Length': String(photo.size),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return materialLibraryRouteError(error, '物料照片读取失败');
  }
}
