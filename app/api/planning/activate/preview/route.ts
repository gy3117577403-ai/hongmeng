import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { chinaDate, chinaWeekRange, parsePlanDate } from '@/lib/production-planning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const body = await req.json().catch(() => ({})) as { weekStartDate?: unknown };
    const requested = parsePlanDate(body.weekStartDate);
    if (!requested) return NextResponse.json({ ok: false, error: '请选择要启用的预备周' }, { status: 400 });
    const range = chinaWeekRange(requested);
    const batches = await prisma.productionPlanBatch.findMany({
      where: {
        deletedAt: null,
        releaseState: 'preparation',
        weekStartDate: range.start,
        workOrderId: { not: null },
      },
      include: {
        planOrder: { select: { specification: true, customerName: true } },
        workOrder: {
          select: {
            materialTask: { select: { status: true, exceptionType: true } },
            processRoute: { select: { status: true } },
          },
        },
      },
      orderBy: [{ plannedCompletionDate: 'asc' }, { batchNo: 'asc' }],
    });
    const items = batches.map(batch => {
      const warnings: string[] = [];
      const warehouse = batch.workOrder?.materialTask?.status || 'not_created';
      const process = batch.workOrder?.processRoute?.status || 'not_created';
      if (warehouse !== 'completed') warnings.push(warehouse === 'exception' ? '仓库存在异常' : '仓库尚未完成配料');
      if (process === 'not_created' || process === 'draft') warnings.push('工艺路线尚未确认');
      return {
        batchId: batch.id,
        specification: batch.planOrder.specification,
        customerName: batch.planOrder.customerName,
        quantity: batch.quantity,
        warehouseStatus: warehouse,
        processStatus: process,
        warnings,
      };
    });
    return NextResponse.json({
      ok: true,
      preview: {
        weekStartDate: chinaDate(range.start),
        weekEndDate: chinaDate(range.end),
        batchCount: items.length,
        totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
        warningCount: items.reduce((sum, item) => sum + item.warnings.length, 0),
        items,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('planning activation preview failed', error);
    return NextResponse.json({ ok: false, error: '本周启用预检失败' }, { status: 500 });
  }
}
