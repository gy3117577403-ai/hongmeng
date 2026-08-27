import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import { loadInternalQualityRiskPrintPreview } from '@/lib/internal-quality-risks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const preview = await loadInternalQualityRiskPrintPreview(
      params.id,
      req.nextUrl.searchParams.get('workOrderId') || '',
    );
    return NextResponse.json({ ok: true, preview });
  } catch (error) {
    return internalQualityRiskRouteError(error, '工单异常警示附页预览加载失败');
  }
}
