import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { safeDisplayFilename } from '@/lib/filenames';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function contentTypeFor(file: { mimeType: string; originalName: string; displayName: string | null }) {
  const filename = safeDisplayFilename(file).toLowerCase();
  if (file.mimeType === 'application/pdf' || filename.endsWith('.pdf')) return 'application/pdf';
  return file.mimeType || 'application/octet-stream';
}

function asciiFilename(filename: string) {
  return filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'file.pdf';
}

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
    if (!file) return NextResponse.json({ ok: false, error: '文件不存在或已被删除' }, { status: 404 });

    const filename = safeDisplayFilename(file);
    const stream = await getObjectStream(file.objectKey);
    const body = Readable.toWeb(stream as unknown as Readable) as unknown as BodyInit;

    return new Response(body, {
      headers: {
        'Content-Type': contentTypeFor(file),
        'Content-Length': String(file.fileSize),
        'Content-Disposition': `inline; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '文件读取失败，请稍后重试' }, { status: 500 });
  }
}
