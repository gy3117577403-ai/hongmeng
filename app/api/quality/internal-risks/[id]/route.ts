import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireCapability, requireUser } from '@/lib/auth';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import {
  expectedInternalQualityRiskVersion,
  loadInternalQualityRisk,
  parseInternalQualityRiskInput,
  serializeInternalQualityRisk,
  softDeleteInternalQualityRisk,
  updateInternalQualityRiskRecord,
} from '@/lib/internal-quality-risks';
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
    const report = await loadInternalQualityRisk(params.id, req.nextUrl.searchParams.get('includeDeleted') === '1');
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    return internalQualityRiskRouteError(error, '内部重大异常加载失败');
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireCapability('QUALITY', 'UPDATE');
    const body = await req.json() as Record<string, unknown>;
    const report = await prisma.$transaction(tx => updateInternalQualityRiskRecord(
      tx,
      params.id,
      parseInternalQualityRiskInput(body),
      expectedInternalQualityRiskVersion(body.expectedVersion),
      actor(user),
    ));
    await logOp({ userId: user.id, action: 'update_internal_quality_risk', targetType: 'internal_quality_risk', targetId: params.id, detail: { version: report.version } });
    return NextResponse.json({ ok: true, report: serializeInternalQualityRisk(report) });
  } catch (error) {
    return internalQualityRiskRouteError(error, '内部重大异常更新失败');
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireAdmin();
    const body = await req.json() as Record<string, unknown>;
    const reason = typeof body.reason === 'string' ? body.reason : '';
    await prisma.$transaction(tx => softDeleteInternalQualityRisk(
      tx,
      params.id,
      expectedInternalQualityRiskVersion(body.expectedVersion),
      reason,
      actor(user),
    ));
    await logOp({ userId: user.id, action: 'delete_internal_quality_risk', targetType: 'internal_quality_risk', targetId: params.id, detail: { reason } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return internalQualityRiskRouteError(error, '内部重大异常移入回收站失败');
  }
}
