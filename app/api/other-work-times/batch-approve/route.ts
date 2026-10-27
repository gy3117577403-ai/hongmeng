import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { otherWorkErrorResponse, otherWorkJson } from '@/lib/other-work-time-http';
import { approveOtherWorkBatch } from '@/lib/other-work-time-batch';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutationRequest(req);
    return NextResponse.json({ ok: true, ...await approveOtherWorkBatch(await requireUser(), await otherWorkJson(req)) });
  } catch (error) { return otherWorkErrorResponse(error); }
}
