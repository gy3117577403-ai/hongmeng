import { NextRequest, NextResponse } from 'next/server';
import { requireQualityRiskParticipant, qualityRiskActor } from '@/lib/quality-risk-access';
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
    const user = await requireQualityRiskParticipant(params.id, 'task');
    const body = await req.json() as Record<string, unknown>;
    const actor = qualityRiskActor(user);
    const assigned = await prisma.internalQualityRiskReport.findUnique({ where: { id: params.id }, select: { ownerUserId: true, createdById: true } });
    const canSubmit = String(body.status) === 'SUBMITTED' && (actor.canManage || actor.canCreate && assigned?.createdById === user.id);
    if (!actor.canVerify && !canSubmit && !(assigned?.ownerUserId === user.id && ['COLLABORATING', 'VERIFYING'].includes(String(body.status)))) return NextResponse.json({ ok: false, error: '只能由主负责人提交处理结果，质量人员执行验证和发布' }, { status: 403 });
    const report = await prisma.$transaction(tx => transitionInternalQualityRiskWorkflow(
      tx,
      params.id,
      expectedInternalQualityRiskVersion(body.expectedVersion),
      String(body.status || ''),
      actor,
      String(body.note || ''),
    ));
    await logOp({ userId: user.id, action: 'transition_internal_quality_risk', targetType: 'internal_quality_risk', targetId: params.id, detail: { status: report.status } });
    return NextResponse.json({ ok: true, report: serializeInternalQualityRisk(report) });
  } catch (error) {
    return internalQualityRiskRouteError(error, '异常流程流转失败');
  }
}
