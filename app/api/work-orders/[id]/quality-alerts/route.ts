import { quickWarningsForOrders } from '@/lib/quality-quick';
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import { loadWorkOrderQualityAlerts } from '@/lib/internal-quality-risks';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    return NextResponse.json({ ok: true, ...(await loadWorkOrderQualityAlerts(params.id)), quickWarningCount: (await quickWarningsForOrders([params.id])).get(params.id)?.length || 0 });
  } catch (error) {
    return internalQualityRiskRouteError(error, '工单质量预警加载失败');
  }
}
