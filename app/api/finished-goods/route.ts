import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { fgRecord } from '@/lib/finished-goods-domain';
import { fgErrorResponse } from '@/lib/finished-goods-http';
import { finishedGoodsDetail, loadFinishedGoods, mutateFinishedGoods } from '@/lib/finished-goods-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    await requireUser();
    const p = request.nextUrl.searchParams;
    if (p.get('lotId')) return NextResponse.json({ ok: true, data: await finishedGoodsDetail(p.get('lotId')!, p.get('shipmentId') || undefined) });
    return NextResponse.json({ ok: true, data: await loadFinishedGoods({ date: p.get('date') || undefined, dateTo: p.get('dateTo') || undefined, dateBasis: p.get('dateBasis') || undefined, sort: p.get('sort') || undefined, scope: p.get('scope') || undefined, view: p.get('view') || undefined, filter: p.get('filter') || undefined, q: p.get('q') || undefined, batchId: p.get('batchId') || undefined, page: Number(p.get('page')) || 1, pageSize: Number(p.get('pageSize')) || 24 }) });
  } catch (error) { return fgErrorResponse(error); }
}
export async function POST(request: NextRequest) {
  try {
    const actor = await requireUser(); const input = fgRecord(await request.json());
    return NextResponse.json({ ok: true, data: await mutateFinishedGoods(input, actor, request.headers.get('idempotency-key')) });
  } catch (error) { return fgErrorResponse(error); }
}
