import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/auth';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import { createInternalQualityRiskTask, serializeInternalQualityRisk } from '@/lib/internal-quality-risks';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireCapability('QUALITY', 'UPDATE');
    const body = await req.json() as Record<string, unknown>;
    const report = await prisma.$transaction(tx => createInternalQualityRiskTask(tx, params.id, body, { id: user.id, name: user.displayName || user.username }));
    await logOp({ userId: user.id, action: 'create_internal_quality_risk_task', targetType: 'internal_quality_risk', targetId: params.id, detail: { taskCount: report.tasks.length } });
    return NextResponse.json({ ok: true, report: serializeInternalQualityRisk(report) });
  } catch (error) {
    return internalQualityRiskRouteError(error, '协同任务建立失败');
  }
}
