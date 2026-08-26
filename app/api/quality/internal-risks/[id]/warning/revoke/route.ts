import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/auth';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import { expectedInternalQualityRiskVersion, revokeInternalQualityRiskWarning, serializeInternalQualityRisk } from '@/lib/internal-quality-risks';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireCapability('QUALITY', 'EXECUTE_WORKFLOW');
    const body = await req.json() as Record<string, unknown>;
    const reason = String(body.reason || '').trim();
    const report = await prisma.$transaction(tx => revokeInternalQualityRiskWarning(tx, params.id, expectedInternalQualityRiskVersion(body.expectedVersion), reason, { id: user.id, name: user.displayName || user.username }));
    await logOp({ userId: user.id, action: 'revoke_internal_quality_risk_warning', targetType: 'internal_quality_risk', targetId: params.id, detail: { reason } });
    return NextResponse.json({ ok: true, report: serializeInternalQualityRisk(report) });
  } catch (error) {
    return internalQualityRiskRouteError(error, '产品异常警示撤销失败');
  }
}
