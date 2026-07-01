import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { serializeWorkOrder } from '@/lib/work-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const old = await prisma.workOrder.findUnique({ where: { id: params.id } });
    if (!old) return NextResponse.json({ ok: false, error: '工单不存在' }, { status: 404 });
    const workOrder = await prisma.workOrder.update({
      where: { id: params.id },
      data: { deletedAt: null },
      include: { resourceFiles: { where: { deletedAt: null, status: 'uploaded' }, select: { categoryId: true } } },
    });
    await logOp({ userId: user.id, action: 'restore_work_order', targetType: 'work_order', targetId: workOrder.id, detail: { code: workOrder.code } });
    return NextResponse.json({ ok: true, workOrder: serializeWorkOrder(workOrder) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    return NextResponse.json({ ok: false, error: '恢复工单失败' }, { status: 500 });
  }
}
