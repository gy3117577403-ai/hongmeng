import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/auth';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import { expectedInternalQualityRiskVersion, serializeInternalQualityRisk, transitionInternalQualityRiskWorkflow } from '@/lib/internal-quality-risks';
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
    const report = await prisma.$transaction(tx => transitionInternalQualityRiskWorkflow(
      tx,
      params.id,
      expectedInternalQualityRiskVersion(body.expectedVersion),
      String(body.status || ''),
      { id: user.id, name: user.displayName || user.username },
    ));
    await logOp({ userId: user.id, action: 'transition_internal_quality_risk', targetType: 'internal_quality_risk', targetId: params.id, detail: { status: report.status } });
    return NextResponse.json({ ok: true, report: serializeInternalQualityRisk(report) });
  } catch (error) {
    return internalQualityRiskRouteError(error, '异常流程流转失败');
  }
}
