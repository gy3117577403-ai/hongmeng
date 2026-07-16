import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { loadProductionOrderById, serializeProductionOrder } from '@/lib/production-execution';
import {
  adjustProductionQuantities,
  ProductionQuantityAdjustmentServiceError,
} from '@/lib/production-quantity-adjustment-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type QuantityAdjustmentBody = {
  targetQty?: unknown;
  frontendTransferredQty?: unknown;
  completedQty?: unknown;
  expectedVersion?: unknown;
  reason?: unknown;
  confirmReopen?: unknown;
};

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as QuantityAdjustmentBody;
    await adjustProductionQuantities({
      workOrderId: params.id,
      targetQty: body.targetQty,
      frontendTransferredQty: body.frontendTransferredQty,
      completedQty: body.completedQty,
      expectedVersion: body.expectedVersion,
      reason: body.reason,
      confirmReopen: body.confirmReopen,
      userId: user.id,
      actor: user.displayName || user.username,
    });
    const workOrder = await loadProductionOrderById(params.id);
    return NextResponse.json({ ok: true, data: workOrder ? serializeProductionOrder(workOrder) : null });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProductionQuantityAdjustmentServiceError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('adjust production quantities failed', error);
    return NextResponse.json({ ok: false, error: '生产数量校正失败' }, { status: 500 });
  }
}
