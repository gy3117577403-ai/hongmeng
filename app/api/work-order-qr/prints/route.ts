import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  createWorkOrderTravelerPrints,
  WorkOrderQrServiceError,
} from '@/lib/work-order-qr-service';
import { sanitizeWorkOrderPrintReturnTo } from '@/lib/work-order-print-navigation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser({ write: 'production' });
    const body = await req.json().catch(() => ({})) as {
      workOrderIds?: unknown;
      mode?: unknown;
      copies?: unknown;
      materials?: unknown;
      materialCopies?: unknown;
      reprintReason?: unknown;
      returnTo?: unknown;
    };
    const prints = await createWorkOrderTravelerPrints({
      workOrderIds: body.workOrderIds,
      mode: body.mode,
      copies: body.copies,
      materials: body.materials,
      materialCopies: body.materialCopies,
      reprintReason: body.reprintReason,
      userId: user.id,
      actor: user.displayName || user.username,
    });
    const query = new URLSearchParams({
      printIds: prints.map(print => print.printId).join(','),
      returnTo: sanitizeWorkOrderPrintReturnTo(body.returnTo),
    });
    return NextResponse.json({
      ok: true,
      data: {
        count: prints.length,
        printIds: prints.map(print => print.printId),
        mode: prints[0]?.mode || 'TRAVELER_ONLY',
        url: `/production/qr-print?${query.toString()}`,
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
    console.error('create traveler prints failed', error);
    return NextResponse.json({ ok: false, error: '流转单生成失败，请稍后重试' }, { status: 500 });
  }
}
