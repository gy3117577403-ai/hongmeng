import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function asciiFilename(filename: string): string {
  return filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'knowledge-attachment';
}

export async function GET(_req: Request, { params }: { params: { attachmentId: string } }) {
  try {
    await requireUser();
    const attachment = await prisma.knowledgeAttachment.findFirst({
      where: { id: params.attachmentId, deletedAt: null, article: { deletedAt: null } },
      select: { objectKey: true, originalName: true, displayName: true, mimeType: true, size: true },
    });
    if (!attachment) return NextResponse.json({ ok: false, error: '附件不存在或已删除' }, { status: 404 });
    const filename = attachment.displayName?.trim() || attachment.originalName;
    const stream = await getObjectStream(attachment.objectKey);
    const body = Readable.toWeb(stream as Readable) as unknown as BodyInit;
    return new Response(body, {
      headers: {
        'Content-Type': attachment.mimeType || 'application/octet-stream',
        'Content-Length': String(attachment.size),
        'Content-Disposition': `inline; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('knowledge attachment content failed', error);
    return NextResponse.json({ ok: false, error: '知识附件读取失败' }, { status: 500 });
  }
}
