import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/auth';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import { previewInternalQualityRiskArchive } from '@/lib/internal-quality-risks';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    await requireCapability('QUALITY', 'EXECUTE_WORKFLOW');
    return NextResponse.json({ ok: true, ...(await previewInternalQualityRiskArchive(params.id)) });
  } catch (error) {
    return internalQualityRiskRouteError(error, '归档检查失败');
  }
}
