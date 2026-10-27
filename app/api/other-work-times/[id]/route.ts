import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { commandOtherWork, detailOtherWork, otherWorkContext } from '@/lib/other-work-time-service';
import { otherWorkErrorResponse, otherWorkJson } from '@/lib/other-work-time-http';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const start = performance.now(), actor = await requireUser(), query = req.nextUrl.searchParams;
    const result = query.get('part') === 'context' ? { context: await otherWorkContext(actor, params.id, query.get('expanded') === '1') }
      : await detailOtherWork(actor, params.id, query.get('part') !== 'base');
    return NextResponse.json({ ok: true, ...result }, { headers: { 'Server-Timing': `other-hours-detail;dur=${(performance.now() - start).toFixed(1)}` } });
  }
  catch (error) { return otherWorkErrorResponse(error); }
}
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try { assertSameOriginMutationRequest(req); return NextResponse.json({ ok: true, row: await commandOtherWork(await requireUser(), params.id, await otherWorkJson(req)) }); }
  catch (error) { return otherWorkErrorResponse(error); }
}
