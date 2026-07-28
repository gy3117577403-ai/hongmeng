import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  ProductTimeRouteLinkError,
  repairHistoricalProductTimeRoute,
} from '@/lib/process-routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = await requireUser();
    if (user.laborRole === 'EMPLOYEE') {
      return forbidden('员工账号不能核对历史工艺路线');
    }
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const currentProductTimeEntryId = String(body.currentProductTimeEntryId || '').trim();
    const processedQuantity = Number(body.processedQuantity);
    if (!currentProductTimeEntryId) {
      return NextResponse.json({ ok: false, error: '请选择当前实际所在工序' }, { status: 400 });
    }
    if (!Number.isInteger(processedQuantity) || processedQuantity < 0) {
      return NextResponse.json({ ok: false, error: '历史已完成数量必须是非负整数' }, { status: 400 });
    }

    const result = await prisma.$transaction(
      tx => repairHistoricalProductTimeRoute(tx, {
        workOrderId: params.id,
        currentProductTimeEntryId,
        processedQuantity,
        actorId: user.id,
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return NextResponse.json({
      ok: true,
      ...result,
      message: `历史工艺已接入 V${result.productTimeProfileVersion}，当前从“${result.currentProcessName}”继续执行`,
    });
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
        { ok: false, error: '工单路线刚刚发生变化，请刷新后重新核对' },
        { status: 409 },
      );
    }
    console.error('repair historical product time route failed', error);
    return NextResponse.json({ ok: false, error: '历史工艺路线核对失败' }, { status: 500 });
  }
}
