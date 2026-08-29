import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  chinaDate,
  editableProductionPlanningWeek,
} from '@/lib/production-planning';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function batchIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))].slice(0, 200);
}

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const ids = batchIds(body.batchIds);
    if (!ids.length) {
      return NextResponse.json({ ok: false, error: '请选择需要调配的排产批次' }, { status: 400 });
    }
    const targetWeek = editableProductionPlanningWeek(body.targetWeekStartDate);
    if (!targetWeek) {
      return NextResponse.json({ ok: false, error: '只能调配到当前起未来 12 周内的生产周' }, { status: 400 });
    }
    const batches = await prisma.productionPlanBatch.findMany({
      where: { id: { in: ids }, deletedAt: null, planOrder: { deletedAt: null } },
      include: {
        planOrder: {
          select: { customerName: true, specification: true },
        },
      },
      orderBy: [{ weekStartDate: 'asc' }, { batchNo: 'asc' }],
    });
    const targetWeekStartDate = chinaDate(targetWeek.start);
    const items = batches.map(batch => {
      const blockers: string[] = [];
      if (batch.releaseState !== 'draft') blockers.push('批次已经下达，必须先走撤回或变更流程');
      if (chinaDate(batch.weekStartDate) === targetWeekStartDate) blockers.push('批次已经位于目标生产周');
      return {
        batchId: batch.id,
        specification: batch.planOrder.specification,
        customerName: batch.planOrder.customerName,
        quantity: batch.quantity,
        sourceWeekStartDate: chinaDate(batch.weekStartDate),
        sourceWeekEndDate: chinaDate(batch.weekEndDate),
        blockers,
      };
    });
    const missingCount = Math.max(0, ids.length - batches.length);
    const blockers = items.reduce((sum, item) => sum + item.blockers.length, 0) + missingCount;
    return NextResponse.json({
      ok: true,
      preview: {
        targetWeekStartDate,
        targetWeekEndDate: chinaDate(targetWeek.end),
        batchCount: ids.length,
        totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
        blockers,
        missingCount,
        items,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('preview planning week move failed', error);
    return NextResponse.json({ ok: false, error: '周次调配预检失败' }, { status: 500 });
  }
}
