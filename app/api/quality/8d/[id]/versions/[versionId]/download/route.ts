import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { eightDRouteError } from '@/lib/eight-d-route-response';
import { EightDReportError } from '@/lib/eight-d-reports';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { signedUrl } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string; versionId: string } }) {
  try {
    const user = await requireUser();
    const version = await prisma.eightDReportVersion.findFirst({
      where: {
        id: params.versionId,
        reportId: params.id,
        deletedAt: null,
        report: { deletedAt: null },
      },
      select: { id: true, objectKey: true, originalName: true, displayName: true, mimeType: true, versionNumber: true },
    });
    if (!version) throw new EightDReportError('PDF版本不存在', 404, 'EIGHT_D_PDF_VERSION_NOT_FOUND');
    await logOp({
      userId: user.id,
      action: 'download_eight_d_report_version',
      targetType: 'eight_d_report',
      targetId: params.id,
      detail: { versionId: version.id, versionNumber: version.versionNumber },
    });
    return NextResponse.redirect(await signedUrl({
      key: version.objectKey,
      filename: (version.displayName || version.originalName || '8D-report.pdf').trim(),
      disposition: 'attachment',
      contentType: 'application/pdf',
    }));
  } catch (error) {
    return eightDRouteError(error, '8D PDF下载失败');
  }
}
