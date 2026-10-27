import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { createOtherWork, listOtherWork, listOtherWorkCompact, otherWorkSummary, otherWorkOptions } from '@/lib/other-work-time-service';
import { selectOtherWorkBatch } from '@/lib/other-work-time-batch';
import { otherWorkErrorResponse, otherWorkJson } from '@/lib/other-work-time-http';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try {
    const start = performance.now();
    const actor = await requireUser(), query = req.nextUrl.searchParams;
    const result = query.get('part') === 'rows' ? await listOtherWorkCompact(actor, query)
      : query.get('part') === 'summary' ? await otherWorkSummary(actor, query)
      : query.get('part') === 'options' ? await otherWorkOptions(actor, query.get('employees') === '1')
      : query.get('part') === 'selection' ? await selectOtherWorkBatch(actor, query)
      : await listOtherWork(actor, query);
    return NextResponse.json({ ok: true, ...result }, { headers: { 'Server-Timing': `other-hours;dur=${(performance.now() - start).toFixed(1)}` } });
  }
  catch (error) { return otherWorkErrorResponse(error); }
}
export async function POST(req: NextRequest) {
  try { assertSameOriginMutationRequest(req); return NextResponse.json({ ok: true, row: await createOtherWork(await requireUser(), await otherWorkJson(req)) }); }
  catch (error) { return otherWorkErrorResponse(error); }
}
