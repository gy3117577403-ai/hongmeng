import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/auth';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import {
  confirmProductRiskForWorkOrder,
  expectedInternalQualityRiskVersion,
  InternalQualityRiskError,
  loadWorkOrderQualityAlerts,
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
    const user = await requireCapability('QUALITY', 'UPDATE');
    const body = await req.json() as Record<string, unknown>;
    const reportId = typeof body.reportId === 'string' ? body.reportId : '';
    if (!reportId) throw new InternalQualityRiskError('缺少异常汇总编号', 400, 'QUALITY_RISK_REPORT_REQUIRED');
    await prisma.$transaction(tx => confirmProductRiskForWorkOrder(
      tx,
      params.id,
      reportId,
      expectedInternalQualityRiskVersion(body.expectedVersion),
      actor(user),
    ));
    await logOp({ userId: user.id, action: 'confirm_product_quality_risk', targetType: 'work_order', targetId: params.id, detail: { reportId } });
    return NextResponse.json({ ok: true, ...(await loadWorkOrderQualityAlerts(params.id)) });
  } catch (error) {
    return internalQualityRiskRouteError(error, '同产品历史风险关联失败');
  }
}
