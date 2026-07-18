import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { chinaWeekRange, parsePlanDate } from '@/lib/production-planning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as { weekStartDate?: unknown; confirmWarnings?: unknown };
    const requested = parsePlanDate(body.weekStartDate);
    if (!requested) return NextResponse.json({ ok: false, error: '请选择要启用的预备周' }, { status: 400 });
    const range = chinaWeekRange(requested);
    const batches = await prisma.productionPlanBatch.findMany({
      where: { deletedAt: null, releaseState: 'preparation', weekStartDate: range.start, workOrderId: { not: null } },
      include: {
        workOrder: { select: { id: true, materialTask: { select: { status: true } }, processRoute: { select: { status: true } } } },
      },
    });
    if (!batches.length) return NextResponse.json({ ok: false, error: '所选周没有可启用的下周预备任务' }, { status: 409 });
    const warningCount = batches.reduce((sum, batch) => {
      const warehouseWarning = batch.workOrder?.materialTask?.status !== 'completed' ? 1 : 0;
      const processStatus = batch.workOrder?.processRoute?.status;
      const processWarning = !processStatus || processStatus === 'draft' ? 1 : 0;
      return sum + warehouseWarning + processWarning;
    }, 0);
    if (warningCount > 0 && body.confirmWarnings !== true) {
      return NextResponse.json({ ok: false, requiresConfirmation: true, error: '仓库或工艺准备尚未全部完成，请确认风险后再启用', warningCount }, { status: 409 });
    }
    const result = await prisma.$transaction(async tx => {
      const now = new Date();
      const nextWorkOrderIds = batches.map(item => item.workOrderId).filter((id): id is string => Boolean(id));
      const current = await tx.productionPlanBatch.findMany({
        where: { deletedAt: null, releaseState: 'active', workOrderId: { not: null } },
        select: { id: true, workOrderId: true, planOrderId: true },
      });
      const currentWorkOrders = await tx.workOrder.findMany({
        where: {
          deletedAt: null,
          planActive: true,
          planType: { in: ['weekly_plan', 'managed_plan'] },
          id: { notIn: nextWorkOrderIds },
        },
        select: { id: true },
      });
      const currentWorkOrderIds = currentWorkOrders.map(item => item.id);
      if (currentWorkOrderIds.length) {
        await tx.workOrder.updateMany({
          where: { id: { in: currentWorkOrderIds } },
          data: { planActive: false, planClearedAt: now, planClearedBy: user.displayName || user.username },
        });
      }
      if (current.length) {
        await tx.productionPlanBatch.updateMany({ where: { id: { in: current.map(item => item.id) } }, data: { releaseState: 'archived' } });
      }
      await tx.workOrder.updateMany({
        where: { id: { in: nextWorkOrderIds } },
        data: { planActive: true, planClearedAt: null, planClearedBy: null },
      });
      await tx.productionPlanBatch.updateMany({
        where: { id: { in: batches.map(item => item.id) } },
        data: { releaseState: 'active', activatedAt: now, activatedById: user.id },
      });
      for (const batch of batches) {
        await tx.productionPlanChange.create({
          data: {
            planOrderId: batch.planOrderId,
            batchId: batch.id,
            action: 'activate_preparation_week',
            beforeData: { releaseState: 'preparation' },
            afterData: { releaseState: 'active', planActive: true },
            impactData: { warningCount },
            actorId: user.id,
          },
        });
      }
      await tx.operationLog.create({
        data: {
          userId: user.id,
          action: 'activate_production_plan_week',
          targetType: 'production_plan_week',
          targetId: range.start.toISOString(),
          detail: {
            batchCount: batches.length,
            warningCount,
            archivedBatchCount: current.length,
            archivedWorkOrderCount: currentWorkOrderIds.length,
          },
        },
      });
      return {
        activated: batches.length,
        archived: current.length,
        archivedWorkOrders: currentWorkOrderIds.length,
        warningCount,
      };
    }, { timeout: 30_000 });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('planning activation commit failed', error);
    return NextResponse.json({ ok: false, error: '启用本周计划失败' }, { status: 500 });
  }
}
