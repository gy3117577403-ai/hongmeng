import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { eightDRouteError } from '@/lib/eight-d-route-response';
import { expectedEightDVersion, restoreEightDReport, serializeEightDReport } from '@/lib/eight-d-reports';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireUser();
    const body = await req.json() as Record<string, unknown>;
    const expectedVersion = expectedEightDVersion(body.expectedVersion);
    const report = await prisma.$transaction(tx => restoreEightDReport(
      tx,
      params.id,
      expectedVersion,
      { id: user.id, name: user.displayName || user.username },
    ));
    await logOp({ userId: user.id, action: 'restore_eight_d_report', targetType: 'eight_d_report', targetId: params.id });
    return NextResponse.json({ ok: true, report: serializeEightDReport(report) });
  } catch (error) {
    return eightDRouteError(error, '8D档案恢复失败');
  }
}
