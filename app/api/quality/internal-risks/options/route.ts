import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import { loadInternalQualityRiskOptions } from '@/lib/internal-quality-risks';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    return NextResponse.json({ ok: true, ...(await loadInternalQualityRiskOptions()) });
  } catch (error) {
    return internalQualityRiskRouteError(error, '内部重大异常关联选项加载失败');
  }
}
