import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';
import { qualityRiskSession, requireQualityRiskParticipant } from '@/lib/quality-risk-access';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function asciiFilename(filename: string): string {
  return filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'quality-risk-evidence';
}

export async function GET(_req: Request, { params }: { params: { attachmentId: string } }) {
  try {
    await qualityRiskSession();
    const attachment = await prisma.internalQualityRiskAttachment.findFirst({
      where: {
        id: params.attachmentId,
        OR: [
          { deletedAt: null, report: { deletedAt: null } },
          { revisionLinks: { some: {} } },
        ],
      },
      select: { reportId: true, objectKey: true, originalName: true, displayName: true, mimeType: true, fileSize: true },
    });
    if (!attachment) return NextResponse.json({ ok: false, error: '证据不存在或已删除' }, { status: 404 });
    const published = await prisma.internalQualityRiskRevisionAttachment.findFirst({
      where: { attachmentId: params.attachmentId, revision: { published: true, currentFor: { is: { deletedAt: null, warningState: 'ACTIVE' } } } },
      select: { revisionId: true },
    });
    // Production/drawing readers may see published evidence, never another incident's working files.
    if (!published) await requireQualityRiskParticipant(attachment.reportId, 'read');
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
    return internalQualityRiskRouteError(error, '证据读取失败');
  }
}
