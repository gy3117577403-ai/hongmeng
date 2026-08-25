import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { eightDRouteError } from '@/lib/eight-d-route-response';
import { EightDReportError } from '@/lib/eight-d-reports';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function filenameFor(version: { displayName: string | null; originalName: string }) {
  return (version.displayName || version.originalName || '8D-report.pdf').trim();
}

function asciiFilename(filename: string) {
  return filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || '8D-report.pdf';
}

export async function GET(_req: Request, { params }: { params: { id: string; versionId: string } }) {
  try {
    await requireUser();
    const version = await prisma.eightDReportVersion.findFirst({
      where: {
        id: params.versionId,
        reportId: params.id,
        deletedAt: null,
        report: { deletedAt: null },
      },
      select: { objectKey: true, originalName: true, displayName: true, mimeType: true, size: true },
    });
    if (!version) throw new EightDReportError('PDF版本不存在', 404, 'EIGHT_D_PDF_VERSION_NOT_FOUND');
    const filename = filenameFor(version);
    const stream = await getObjectStream(version.objectKey);
    const body = Readable.toWeb(stream as unknown as Readable) as unknown as BodyInit;
    return new Response(body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(version.size),
        'Content-Disposition': `inline; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return eightDRouteError(error, '8D PDF读取失败');
  }
}
