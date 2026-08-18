import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  deleteProductionPlanOrderDirectly,
  isProductionPlanDirectDeleteConfirmationValid,
  normalizeProductionPlanDirectDeleteReason,
  ProductionPlanDirectDeletionError,
} from '@/lib/production-plan-direct-deletion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, context: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as {
      confirmationCode?: unknown;
      reason?: unknown;
    };
    if (!isProductionPlanDirectDeleteConfirmationValid(body.confirmationCode)) {
      return NextResponse.json({ ok: false, error: '删除确认码不正确，请输入 111' }, { status: 400 });
    }
    const result = await prisma.$transaction(
      tx => deleteProductionPlanOrderDirectly(tx, {
        planOrderId: context.params.id,
        actorId: user.id,
        actorLabel: user.displayName || user.username || user.id,
        reason: normalizeProductionPlanDirectDeleteReason(body.reason),
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 },
    );
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProductionPlanDirectDeletionError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return NextResponse.json({ ok: false, error: '订单刚刚发生变化，请再次点击删除' }, { status: 409 });
    }
    console.error('direct planning order deletion failed', error);
    return NextResponse.json({ ok: false, error: '删除订单失败，请稍后重试' }, { status: 500 });
  }
}
