import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import { permanentlyDeleteInternalQualityRisk } from '@/lib/internal-quality-risks';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { processQualityRiskCleanup } from '@/lib/quality-risk-cleanup';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireAdmin();
    const body = await req.json() as Record<string, unknown>;
    const confirmation = typeof body.confirmation === 'string' ? body.confirmation : '';
    const result = await prisma.$transaction(tx => permanentlyDeleteInternalQualityRisk(tx, params.id, confirmation, { id: user.id, name: user.displayName || user.username }, String(body.reason || '')));
    const cleanup = await processQualityRiskCleanup();
    await logOp({ userId: user.id, action: 'purge_internal_quality_risk', targetType: 'internal_quality_risk', targetId: params.id, detail: { reportNo: result.reportNo } });
    return NextResponse.json({ ok: true, reportNo: result.reportNo, cleanup });
  } catch (error) {
    return internalQualityRiskRouteError(error, '内部重大异常彻底删除失败');
  }
}
