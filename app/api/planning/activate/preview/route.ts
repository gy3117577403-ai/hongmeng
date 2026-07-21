import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { productTimeTotalMilliseconds } from '@/lib/product-time';
import {
  chinaDate,
  chinaWeekRange,
  effectivePlanningUnitMilliseconds,
  parsePlanDate,
  productionPlanTargetWeek,
} from '@/lib/production-planning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const body = await req.json().catch(() => ({})) as { weekStartDate?: unknown };
    const requested = parsePlanDate(body.weekStartDate);
    if (!requested) return NextResponse.json({ ok: false, error: '请选择要启用的预备周' }, { status: 400 });
    const range = chinaWeekRange(requested);
    const targetRange = productionPlanTargetWeek('active');
    const batches = await prisma.productionPlanBatch.findMany({
      where: {
        deletedAt: null,
        releaseState: 'preparation',
        weekStartDate: range.start,
        workOrderId: { not: null },
      },
      include: {
        productTimeProfile: { select: { id: true, entries: { select: { unitMilliseconds: true } } } },
        planOrder: {
          select: {
            specification: true,
            customerName: true,
            planningUnitMilliseconds: true,
            drawingLibraryItem: {
              select: {
                productTimeProfiles: {
                  where: { status: 'published' },
                  orderBy: { version: 'desc' },
                  take: 1,
                  select: { id: true, entries: { select: { unitMilliseconds: true } } },
                },
              },
            },
          },
        },
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
      const blockers: string[] = [];
      const warehouse = batch.workOrder?.materialTask?.status || 'not_created';
      const process = batch.workOrder?.processRoute?.status || 'not_created';
      const productTimeProfile = batch.productTimeProfile
        || batch.planOrder.drawingLibraryItem?.productTimeProfiles[0]
        || null;
      const effectiveUnitMilliseconds = effectivePlanningUnitMilliseconds(
        batch.unitMillisecondsSnapshot,
        productTimeProfile ? productTimeTotalMilliseconds(productTimeProfile.entries) : null,
        batch.planOrder.planningUnitMilliseconds,
      );
      if (!productTimeProfile) blockers.push('产品工序与工时尚未发布，不能启用生产');
      else if (!effectiveUnitMilliseconds) blockers.push('已发布产品工时无有效总工时，不能启用生产');
      if (warehouse !== 'completed') warnings.push(warehouse === 'exception' ? '仓库存在异常' : '仓库尚未完成配料');
      if (process === 'not_created' || process === 'draft') warnings.push('工艺路线尚未确认');
      if (chinaDate(range.start) !== chinaDate(targetRange.start)) {
        warnings.push(`生产周将从 ${chinaDate(range.start)} 至 ${chinaDate(range.end)} 调整为本周 ${chinaDate(targetRange.start)} 至 ${chinaDate(targetRange.end)}`);
      }
      return {
        batchId: batch.id,
        specification: batch.planOrder.specification,
        customerName: batch.planOrder.customerName,
        quantity: batch.quantity,
        warehouseStatus: warehouse,
        processStatus: process,
        warnings,
        blockers,
      };
    });
    return NextResponse.json({
      ok: true,
      preview: {
        sourceWeekStartDate: chinaDate(range.start),
        sourceWeekEndDate: chinaDate(range.end),
        weekStartDate: chinaDate(targetRange.start),
        weekEndDate: chinaDate(targetRange.end),
        batchCount: items.length,
        totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
        warningCount: items.reduce((sum, item) => sum + item.warnings.length, 0),
        blockerCount: items.reduce((sum, item) => sum + item.blockers.length, 0),
        items,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('planning activation preview failed', error);
    return NextResponse.json({ ok: false, error: '本周启用预检失败' }, { status: 500 });
  }
}
