import { NextRequest, NextResponse } from 'next/server';
import { requireQualityRiskParticipant, qualityRiskActor } from '@/lib/quality-risk-access';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import { serializeInternalQualityRisk, updateInternalQualityRiskTask } from '@/lib/internal-quality-risks';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string; taskId: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireQualityRiskParticipant(params.id, 'task');
    const body = await req.json() as Record<string, unknown>;
    const report = await prisma.$transaction(tx => updateInternalQualityRiskTask(tx, params.id, params.taskId, body, qualityRiskActor(user)));
    await logOp({ userId: user.id, action: 'update_internal_quality_risk_task', targetType: 'internal_quality_risk_task', targetId: params.taskId, detail: { reportId: params.id, status: String(body.status || '') } });
    return NextResponse.json({ ok: true, report: serializeInternalQualityRisk(report) });
  } catch (error) {
    return internalQualityRiskRouteError(error, '协同任务更新失败');
  }
}
