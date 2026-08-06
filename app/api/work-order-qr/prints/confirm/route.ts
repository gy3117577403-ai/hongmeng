import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  confirmWorkOrderTravelerPrints,
  WorkOrderQrServiceError,
} from '@/lib/work-order-qr-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser({ write: 'production' });
    const body = await req.json().catch(() => ({})) as { printIds?: unknown; materials?: unknown };
    const result = await confirmWorkOrderTravelerPrints({
      printIds: body.printIds,
      materials: body.materials,
      userId: user.id,
      actor: user.displayName || user.username,
    });
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof WorkOrderQrServiceError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error('confirm traveler prints failed', error);
    return NextResponse.json({ ok: false, error: '打印确认失败，请稍后重试' }, { status: 500 });
  }
}
