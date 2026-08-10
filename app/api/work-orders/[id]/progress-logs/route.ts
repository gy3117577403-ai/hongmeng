import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { workOrderStageText } from '@/lib/work-orders';
import { productionWorkOrderScopeWhere } from '@/lib/production-execution';
import {
  assertProductionScopeRead,
  ProductionAccessScopeError,
  resolveProductionEntityScope,
} from '@/lib/production-access-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function positiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const productionScope = resolveProductionEntityScope(user);
    assertProductionScopeRead(productionScope);
    const order = await prisma.workOrder.findFirst({
      where: { id: params.id, deletedAt: null, ...productionWorkOrderScopeWhere(productionScope) },
      select: { id: true },
    });
    if (!order) return NextResponse.json({ ok: false, error: '工单不存在' }, { status: 404 });
    const page = positiveInt(req.nextUrl.searchParams.get('page'), 1);
    const pageSize = Math.min(positiveInt(req.nextUrl.searchParams.get('pageSize'), 50), 50);
    const [total, logs] = await prisma.$transaction([
      prisma.workOrderProgressLog.count({ where: { workOrderId: params.id } }),
      prisma.workOrderProgressLog.findMany({
        where: { workOrderId: params.id },
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return NextResponse.json({
      ok: true,
      data: {
        items: logs.map(log => ({
          id: log.id,
          previousStage: log.previousStage,
          previousStageText: log.previousStage ? workOrderStageText(log.previousStage) : null,
          stage: log.stage,
          stageText: workOrderStageText(log.stage),
          completedQty: log.completedQty,
          productionOwner: log.productionOwner,
          workstation: log.workstation,
          remark: log.remark,
          createdBy: log.createdBy,
          createdAt: log.createdAt.toISOString(),
        })),
        pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProductionAccessScopeError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('load work order progress logs failed', error);
    return NextResponse.json({ ok: false, error: '进度记录加载失败' }, { status: 500 });
  }
}
