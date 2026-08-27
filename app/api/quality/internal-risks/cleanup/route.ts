import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { processQualityRiskCleanup } from '@/lib/quality-risk-cleanup';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  try { assertSameOriginMutationRequest(req); await requireAdmin(); return NextResponse.json({ ok: true, ...await processQualityRiskCleanup() }); }
  catch (error) { return internalQualityRiskRouteError(error, '附件清理重试失败'); }
}
