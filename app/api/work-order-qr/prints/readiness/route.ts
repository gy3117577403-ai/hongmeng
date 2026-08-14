import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  loadWorkOrderTravelerPrintReadiness,
  WorkOrderQrServiceError,
} from '@/lib/work-order-qr-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    await requireUser({ write: 'production' });
    const body = await req.json().catch(() => ({})) as { workOrderIds?: unknown };
    const items = await loadWorkOrderTravelerPrintReadiness({ workOrderIds: body.workOrderIds });
    return NextResponse.json({
      ok: true,
      data: {
        count: items.length,
        items,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof WorkOrderQrServiceError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error('load traveler print readiness failed', error);
    return NextResponse.json({ ok: false, error: '生产资料校验失败，请稍后重试' }, { status: 500 });
  }
}
