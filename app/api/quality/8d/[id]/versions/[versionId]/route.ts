import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { eightDRouteError } from '@/lib/eight-d-route-response';
import { expectedEightDVersion, serializeEightDReport, softDeleteEightDReportVersion } from '@/lib/eight-d-reports';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, { params }: { params: { id: string; versionId: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireUser();
    const body = await req.json() as Record<string, unknown>;
    const expectedVersion = expectedEightDVersion(body.expectedVersion);
    const report = await prisma.$transaction(tx => softDeleteEightDReportVersion(
      tx,
      params.id,
      params.versionId,
      expectedVersion,
      { id: user.id, name: user.displayName || user.username },
    ));
    await logOp({
      userId: user.id,
      action: 'delete_eight_d_report_version',
      targetType: 'eight_d_report',
      targetId: params.id,
      detail: { versionId: params.versionId },
    });
    return NextResponse.json({ ok: true, report: serializeEightDReport(report) });
  } catch (error) {
    return eightDRouteError(error, 'PDF版本移入回收站失败');
  }
}
