import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  applyPublishedProductTimeToWorkOrder,
  ProductTimeRouteLinkError,
} from '@/lib/process-routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = await requireUser();
    if (user.laborRole === 'EMPLOYEE') {
      return forbidden('员工账号不能调整工单工艺路线');
    }
    const result = await prisma.$transaction(
      tx => applyPublishedProductTimeToWorkOrder(tx, {
        workOrderId: params.id,
        actorId: user.id,
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    const message = result.action === 'already_applied'
      ? `当前工单已使用产品工艺 V${result.productTimeProfileVersion}`
      : `${result.processCount} 道工序已应用到当前工单`;
    return NextResponse.json({ ok: true, ...result, message });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProductTimeRouteLinkError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return NextResponse.json(
        { ok: false, error: '工单路线刚刚发生变化，请刷新后重试', code: 'PRODUCT_TIME_ROUTE_CONFLICT' },
        { status: 409 },
      );
    }
    console.error('apply product time route failed', error);
    return NextResponse.json(
      { ok: false, error: '应用产品工序与工时失败' },
      { status: 500 },
    );
  }
}
