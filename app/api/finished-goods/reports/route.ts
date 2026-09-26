import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { FinishedGoodsError, fgRecord } from '@/lib/finished-goods-domain';
import { fgErrorResponse } from '@/lib/finished-goods-http';
import { saveShippingReport, shippingReportContext } from '@/lib/shipping-report-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    await requireUser();
    return NextResponse.json({ ok: true, data: await shippingReportContext(Object.fromEntries(request.nextUrl.searchParams)) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return fgErrorResponse(error); }
}
export async function POST(request: NextRequest) {
  try {
    const actor = await requireUser();
    const body = await request.text();
    if (body.length > 16000) throw new FinishedGoodsError('报告信息过长');
    return NextResponse.json({ ok: true, data: await saveShippingReport(fgRecord(JSON.parse(body)), actor, request.headers.get('idempotency-key')) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return fgErrorResponse(error); }
}
