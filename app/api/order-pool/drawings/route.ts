import { NextRequest, NextResponse } from 'next/server';
import { requireUser, UnauthorizedError, unauthorized } from '@/lib/auth';
import { matchPoolDrawing } from '@/lib/order-pool-drawings';

export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const p = req.nextUrl.searchParams;
    const customerName = (p.get('customer') || '').trim().slice(0, 120);
    const specification = (p.get('specification') || '').trim().slice(0, 180);
    if (!customerName || !specification) return NextResponse.json({ ok: false, error: '请先填写客户和产品规格' }, { status: 400 });
    const drawing = await matchPoolDrawing({ customerName, specification, drawingLibraryItemId: (p.get('selected') || '').slice(0, 80) || null });
    return NextResponse.json({ ok: true, drawing });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized(error);
    console.error('order pool drawing match', error);
    return NextResponse.json({ ok: false, error: '图纸档案读取失败，请重试' }, { status: 500 });
  }
}
