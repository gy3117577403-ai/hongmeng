import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function asciiFilename(filename: string): string {
  return filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'training-attachment';
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const attachment = await prisma.trainingAttachment.findFirst({
      where: { id: params.id, deletedAt: null },
      select: { objectKey: true, originalName: true, displayName: true, mimeType: true, size: true },
    });
    if (!attachment) return NextResponse.json({ ok: false, error: '附件不存在或已删除' }, { status: 404 });
    const filename = attachment.displayName?.trim() || attachment.originalName;
    const stream = await getObjectStream(attachment.objectKey);
    return new Response(Readable.toWeb(stream as Readable) as unknown as BodyInit, {
      headers: {
        'Content-Type': attachment.mimeType || 'application/octet-stream',
        'Content-Length': String(attachment.size),
        'Content-Disposition': `inline; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('training attachment content failed', error);
    return NextResponse.json({ ok: false, error: '培训附件读取失败' }, { status: 500 });
  }
}
