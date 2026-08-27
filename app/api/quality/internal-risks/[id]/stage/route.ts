import { NextResponse } from 'next/server';
import { requireQualityRiskParticipant, qualityRiskActor } from '@/lib/quality-risk-access';
import { actOnQualityWorkflow } from '@/lib/quality-workflow-v3';
import { expectedInternalQualityRiskVersion, serializeInternalQualityRisk } from '@/lib/internal-quality-risks';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
export const dynamic = 'force-dynamic';
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireQualityRiskParticipant(params.id, 'task');
    const body = await req.json();
    const report = await prisma.$transaction(tx => actOnQualityWorkflow(tx, params.id,
      expectedInternalQualityRiskVersion(body.expectedVersion), String(body.action || ''), body.payload || {}, qualityRiskActor(user)));
    return NextResponse.json({ ok: true, report: serializeInternalQualityRisk(report) });
  } catch (error) { return internalQualityRiskRouteError(error, '阶段操作失败'); }
}
