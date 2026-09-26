import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { FinishedGoodsError, fgRecord } from '@/lib/finished-goods-domain';
import { fgErrorResponse } from '@/lib/finished-goods-http';
import { previewShippingReport } from '@/lib/shipping-report-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  try {
    await requireUser();
    const body = await request.text();
    if (body.length > 16000) throw new FinishedGoodsError('报告信息过长');
    const result = await previewShippingReport(fgRecord(JSON.parse(body)));
    return new NextResponse(new Uint8Array(result.bytes), { headers: {
      'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store',
      'X-Drawing-Pages': String(result.drawingPages), 'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) { return fgErrorResponse(error); }
}
