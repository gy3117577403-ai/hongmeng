import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { createWorkOrderProcessRoute } from '@/lib/process-routing';
import { activeWeeklyWhere, draftWeeklyWhere, parseWeek, summarizeWeeklyActivateNext } from '@/lib/weekly-work-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const weekStartDate = parseWeek(body.weekStartDate);
    if (!weekStartDate) return NextResponse.json({ ok: false, error: '请选择有效的下周开始日期' }, { status: 400 });

    const confirmText = String(body.confirmText || '').trim();
    if (confirmText !== 'START_NEXT_WEEK') {
      return NextResponse.json({ ok: false, error: '请输入 START_NEXT_WEEK 确认启用下周' }, { status: 400 });
    }

    const before = await summarizeWeeklyActivateNext(weekStartDate);
    if (before.nextActivateCount <= 0) {
      return NextResponse.json({ ok: false, error: '未找到该周的下周草稿工单，请先导入下周工单' }, { status: 400 });
    }
    if (before.blockingAnomalyCount > 0) {
      return NextResponse.json({
        ok: false,
        error: `存在 ${before.blockingAnomalyCount} 项阻断异常，请先到周计划差异中心处理`,
        summary: before,
      }, { status: 409 });
    }
    if (before.missingProductTimeProfiles > 0) {
      return NextResponse.json({
        ok: false,
        error: `有 ${before.missingProductTimeProfiles} 个工单尚未发布产品工序与工时，不能启用下周`,
        summary: before,
      }, { status: 409 });
    }

    const now = new Date();
    const userName = user.displayName || user.username;
    const result = await prisma.$transaction(async tx => {
      const archived = await tx.workOrder.updateMany({
        where: activeWeeklyWhere(),
        data: {
          planActive: false,
          planClearedAt: now,
          planClearedBy: userName,
        },
      });
      const activated = await tx.workOrder.updateMany({
        where: draftWeeklyWhere(weekStartDate),
        data: {
          planActive: true,
          planClearedAt: null,
          planClearedBy: null,
          materialStatus: '未配料',
        },
      });
      if (activated.count <= 0) throw new Error('NEXT_WEEK_ALREADY_ACTIVATED');
      const activatedOrders = await tx.workOrder.findMany({
        where: activeWeeklyWhere(weekStartDate),
        select: { id: true },
      });
      const materialTasks = await tx.warehouseMaterialTask.createMany({
        data: activatedOrders.map(order => ({ workOrderId: order.id, status: 'pending' })),
        skipDuplicates: true,
      });
      let processRoutesCreated = 0;
      for (const order of activatedOrders) {
        const route = await createWorkOrderProcessRoute(tx, {
          workOrderId: order.id,
          actorId: user.id,
        });
        if (route.created) processRoutesCreated += 1;
      }
      return {
        archived: archived.count,
        activated: activated.count,
        materialTasksCreated: materialTasks.count,
        processRoutesCreated,
      };
    });

    await logOp({
      userId: user.id,
      action: 'activate_next_week',
      targetType: 'work_order',
      detail: {
        weekStartDate: before.weekStartDate,
        weekEndDate: before.weekEndDate,
        archivedWorkOrders: result.archived,
        activatedWorkOrders: result.activated,
        materialTasksCreated: result.materialTasksCreated,
        processRoutesCreated: result.processRoutesCreated,
        missingWorkOrders: before.missingWorkOrders,
        anomalyCount: before.anomalyCount,
        warningCount: before.warningCount,
        newCount: before.newCount,
        continuedCount: before.continuedCount,
        changedCount: before.changedCount,
        removedCount: before.removedCount,
      },
    });

    return NextResponse.json({
      ok: true,
      summary: {
        ...before,
        archivedCount: result.archived,
        activatedCount: result.activated,
        materialTasksCreated: result.materialTasksCreated,
        processRoutesCreated: result.processRoutesCreated,
      },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    if (e instanceof Error && e.message === 'NEXT_WEEK_ALREADY_ACTIVATED') {
      return NextResponse.json({ ok: false, error: '下周计划已被启用，请刷新页面确认当前周' }, { status: 409 });
    }
    console.error(e);
    return NextResponse.json({ ok: false, error: '启用下周失败' }, { status: 500 });
  }
}
