import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { eightDRouteError } from '@/lib/eight-d-route-response';
import {
  expectedEightDVersion,
  loadEightDReport,
  parseEightDReportMetadata,
  serializeEightDReport,
  softDeleteEightDReport,
  updateEightDReportRecord,
} from '@/lib/eight-d-reports';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function actor(user: { id: string; displayName: string; username: string }) {
  return { id: user.id, name: user.displayName || user.username };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const report = await loadEightDReport(params.id, req.nextUrl.searchParams.get('includeDeleted') === '1');
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    return eightDRouteError(error, '8D档案加载失败');
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireUser();
    const body = await req.json() as Record<string, unknown>;
    const metadata = parseEightDReportMetadata(body);
    const expectedVersion = expectedEightDVersion(body.expectedVersion);
    const report = await prisma.$transaction(tx => updateEightDReportRecord(
      tx,
      params.id,
      metadata,
      expectedVersion,
      actor(user),
    ));
    await logOp({
      userId: user.id,
      action: 'update_eight_d_report',
      targetType: 'eight_d_report',
      targetId: report.id,
      detail: {
        reportNo: report.reportNo,
        version: report.version,
        productCount: metadata.productIds.length,
        issueCount: metadata.issueIds.length,
      },
    });
    return NextResponse.json({ ok: true, report: serializeEightDReport(report) });
  } catch (error) {
    return eightDRouteError(error, '8D档案更新失败');
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireUser();
    const body = await req.json() as Record<string, unknown>;
    const expectedVersion = expectedEightDVersion(body.expectedVersion);
    const reason = typeof body.reason === 'string' ? body.reason : '';
    await prisma.$transaction(tx => softDeleteEightDReport(tx, params.id, expectedVersion, reason, actor(user)));
    await logOp({
      userId: user.id,
      action: 'delete_eight_d_report',
      targetType: 'eight_d_report',
      targetId: params.id,
      detail: { reason },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return eightDRouteError(error, '8D档案移入回收站失败');
  }
}
