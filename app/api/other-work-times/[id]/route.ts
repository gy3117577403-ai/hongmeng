import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { commandOtherWork, detailOtherWork } from '@/lib/other-work-time-service';
import { otherWorkErrorResponse, otherWorkJson } from '@/lib/other-work-time-http';
export const dynamic = 'force-dynamic';
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try { return NextResponse.json({ ok: true, ...await detailOtherWork(await requireUser(), params.id) }); }
  catch (error) { return otherWorkErrorResponse(error); }
}
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try { assertSameOriginMutationRequest(req); return NextResponse.json({ ok: true, row: await commandOtherWork(await requireUser(), params.id, await otherWorkJson(req)) }); }
  catch (error) { return otherWorkErrorResponse(error); }
}
