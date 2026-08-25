import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/auth';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import {
  expectedInternalQualityRiskVersion,
  serializeInternalQualityRisk,
  startInternalQualityRiskRevision,
} from '@/lib/internal-quality-risks';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

function actor(user: { id: string; displayName: string; username: string }) {
  return { id: user.id, name: user.displayName || user.username };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireCapability('QUALITY', 'EXECUTE_WORKFLOW');
    const body = await req.json() as Record<string, unknown>;
    const report = await prisma.$transaction(tx => startInternalQualityRiskRevision(
      tx,
      params.id,
      expectedInternalQualityRiskVersion(body.expectedVersion),
      actor(user),
    ));
    await logOp({ userId: user.id, action: 'revise_internal_quality_risk', targetType: 'internal_quality_risk', targetId: params.id });
    return NextResponse.json({ ok: true, report: serializeInternalQualityRisk(report) });
  } catch (error) {
    return internalQualityRiskRouteError(error, '启动异常汇总修订失败');
  }
}
