import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import { acknowledgeWorkOrderQualityAlert, serializeWorkOrderQualityAlert } from '@/lib/internal-quality-risks';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

function actor(user: { id: string; displayName: string; username: string }) {
  return { id: user.id, name: user.displayName || user.username };
}

export async function POST(req: NextRequest, { params }: { params: { id: string; alertId: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const alert = await prisma.$transaction(tx => acknowledgeWorkOrderQualityAlert(
      tx,
      params.id,
      params.alertId,
      typeof body.note === 'string' ? body.note : '',
      actor(user),
    ));
    await logOp({ userId: user.id, action: 'acknowledge_work_order_quality_alert', targetType: 'work_order_quality_alert', targetId: params.alertId, detail: { workOrderId: params.id } });
    return NextResponse.json({ ok: true, alert: serializeWorkOrderQualityAlert(alert) });
  } catch (error) {
    return internalQualityRiskRouteError(error, '工单质量预警知悉失败');
  }
}
