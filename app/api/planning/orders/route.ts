import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  chinaDate,
  chinaWeekRange,
  parseProductionPlanOrderInput,
  planOrderSnapshot,
  productionPlanOrderInclude,
  resolvePlanningReferences,
  serializeProductionPlanOrder,
} from '@/lib/production-planning';
import type { ProductionPlanningSummaryDTO } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function keywordWhere(keyword: string): Prisma.ProductionPlanOrderWhereInput {
  return {
    OR: [
      { sourceOrderNo: { contains: keyword, mode: 'insensitive' } },
      { customerName: { contains: keyword, mode: 'insensitive' } },
      { salesperson: { contains: keyword, mode: 'insensitive' } },
      { productName: { contains: keyword, mode: 'insensitive' } },
      { specification: { contains: keyword, mode: 'insensitive' } },
      { remark: { contains: keyword, mode: 'insensitive' } },
    ],
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const keyword = String(req.nextUrl.searchParams.get('keyword') || '').trim().slice(0, 160);
    const status = String(req.nextUrl.searchParams.get('status') || '').trim();
    const customer = String(req.nextUrl.searchParams.get('customer') || '').trim().slice(0, 120);
    const where: Prisma.ProductionPlanOrderWhereInput = {
      deletedAt: null,
      ...(keyword ? keywordWhere(keyword) : {}),
      ...(status && status !== 'all' ? { status } : {}),
      ...(customer ? { customerName: customer } : {}),
    };
    const records = await prisma.productionPlanOrder.findMany({
      where,
      include: productionPlanOrderInclude,
      orderBy: [{ priority: 'asc' }, { customerDueDate: 'asc' }, { createdAt: 'desc' }],
      take: 1000,
    });
    const allRecords = keyword || (status && status !== 'all') || customer
      ? await prisma.productionPlanOrder.findMany({
          where: { deletedAt: null },
          include: productionPlanOrderInclude,
          orderBy: { customerDueDate: 'asc' },
          take: 2000,
        })
      : records;
    const all = allRecords.map(serializeProductionPlanOrder);
    const batches = all.flatMap(order => order.batches);
    const naturalCurrentWeek = chinaWeekRange(new Date());
    const currentStart = chinaDate(naturalCurrentWeek.start);
    const currentEnd = chinaDate(naturalCurrentWeek.end);
    const nextWeekStart = new Date(`${currentStart}T00:00:00+08:00`);
    nextWeekStart.setUTCDate(nextWeekStart.getUTCDate() + 7);
    const nextWeek = chinaWeekRange(nextWeekStart);
    const nextStart = chinaDate(nextWeek.start);
    const summary: ProductionPlanningSummaryDTO = {
      orderCount: all.length,
      pendingOrderCount: all.filter(order => order.status === 'pending').length,
      scheduledOrderCount: all.filter(order => order.status === 'scheduled' || order.status === 'partially_released').length,
      thisWeekBatchCount: batches.filter(batch => batch.weekStartDate === currentStart).length,
      nextWeekBatchCount: batches.filter(batch => batch.weekStartDate === nextStart).length,
      preparationBatchCount: batches.filter(batch => batch.releaseState === 'preparation').length,
      activeBatchCount: batches.filter(batch => batch.releaseState === 'active').length,
      missingDrawingCount: all.filter(order => order.drawingFileCount === 0).length,
      missingProductTimeCount: all.filter(order => !order.currentUnitMilliseconds).length,
      warehouseExceptionCount: batches.filter(batch => batch.warehouseStatus === 'exception').length,
      processPendingCount: batches.filter(batch => batch.releaseState !== 'draft' && (batch.processStatus === 'not_created' || batch.processStatus === 'draft')).length,
    };
    const customers = [...new Set(all.map(order => order.customerName))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return NextResponse.json({
      ok: true,
      orders: records.map(serializeProductionPlanOrder),
      summary,
      customers,
      periods: {
        current: { weekStartDate: currentStart, weekEndDate: currentEnd },
        next: { weekStartDate: nextStart, weekEndDate: chinaDate(nextWeek.end) },
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('planning order list failed', error);
    return NextResponse.json({ ok: false, error: '计划订单加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const parsed = parseProductionPlanOrderInput(body);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    const record = await prisma.$transaction(async tx => {
      const references = await resolvePlanningReferences(tx, parsed.data);
      const created = await tx.productionPlanOrder.create({
        data: {
          ...parsed.data,
          drawingLibraryItemId: references.drawingLibraryItemId,
          createdById: user.id,
          updatedById: user.id,
        },
        include: productionPlanOrderInclude,
      });
      await tx.productionPlanChange.create({
        data: {
          planOrderId: created.id,
          action: 'create_plan_order',
          afterData: planOrderSnapshot(parsed.data),
          actorId: user.id,
        },
      });
      await tx.operationLog.create({
        data: {
          userId: user.id,
          action: 'create_production_plan_order',
          targetType: 'production_plan_order',
          targetId: created.id,
          detail: { sourceOrderNo: created.sourceOrderNo, sourceLineNo: created.sourceLineNo },
        },
      });
      return created;
    });
    return NextResponse.json({ ok: true, order: serializeProductionPlanOrder(record) }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ ok: false, error: '计划订单内部编号冲突，请重试' }, { status: 409 });
    }
    console.error('create planning order failed', error);
    return NextResponse.json({ ok: false, error: '新建计划订单失败' }, { status: 500 });
  }
}
