import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { safeDisplayFilename } from '@/lib/filenames';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const file = await prisma.resourceFile.findFirst({
      where: { id: params.id, deletedAt: null, status: 'uploaded' },
      select: {
        objectKey: true,
        originalName: true,
        displayName: true,
        mimeType: true,
        fileSize: true,
      },
    });
    if (!file) return NextResponse.json({ message: '文件不存在' }, { status: 404 });

    const stream = await getObjectStream(file.objectKey);
    const body = Readable.toWeb(stream as unknown as Readable) as unknown as BodyInit;
    return new Response(body, {
      headers: {
        'Content-Type': file.mimeType || 'application/octet-stream',
        'Content-Length': String(file.fileSize),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(safeDisplayFilename(file))}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ message: '文件读取失败' }, { status: 500 });
  }
}
