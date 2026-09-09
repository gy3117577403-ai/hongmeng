import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { createOtherWork, listOtherWork } from '@/lib/other-work-time-service';
import { otherWorkErrorResponse, otherWorkJson } from '@/lib/other-work-time-http';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try { return NextResponse.json({ ok: true, ...await listOtherWork(await requireUser(), req.nextUrl.searchParams) }); }
  catch (error) { return otherWorkErrorResponse(error); }
}
export async function POST(req: NextRequest) {
  try { assertSameOriginMutationRequest(req); return NextResponse.json({ ok: true, row: await createOtherWork(await requireUser(), await otherWorkJson(req)) }); }
  catch (error) { return otherWorkErrorResponse(error); }
}
