import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function asciiFilename(filename: string): string {
  return filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'quality-risk-evidence';
}

export async function GET(_req: Request, { params }: { params: { attachmentId: string } }) {
  try {
    await requireUser();
    const attachment = await prisma.internalQualityRiskAttachment.findFirst({
      where: {
        id: params.attachmentId,
        OR: [
          { deletedAt: null, report: { deletedAt: null } },
          { revisionLinks: { some: {} } },
        ],
      },
      select: { objectKey: true, originalName: true, displayName: true, mimeType: true, fileSize: true },
    });
    if (!attachment) return NextResponse.json({ ok: false, error: '证据不存在或已删除' }, { status: 404 });
    const filename = attachment.displayName || attachment.originalName;
    const stream = await getObjectStream(attachment.objectKey);
    return new Response(Readable.toWeb(stream as Readable) as unknown as BodyInit, { headers: {
      'Content-Type': attachment.mimeType || 'application/octet-stream',
      'Content-Length': String(attachment.fileSize),
      'Content-Disposition': `inline; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('quality risk attachment content failed', error);
    return NextResponse.json({ ok: false, error: '证据读取失败' }, { status: 500 });
  }
}
