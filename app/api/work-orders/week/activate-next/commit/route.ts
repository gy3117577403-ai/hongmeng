import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
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
        },
      });
      return { archived: archived.count, activated: activated.count };
    });

    await logOp({
      userId: user.id,
      action: 'activate_next_weekly_work_orders',
      targetType: 'work_order',
      detail: {
        weekStartDate: before.weekStartDate,
        weekEndDate: before.weekEndDate,
        archivedWorkOrders: result.archived,
        activatedWorkOrders: result.activated,
        missingWorkOrders: before.missingWorkOrders,
        anomalyCount: before.anomalyCount,
      },
    });

    return NextResponse.json({
      ok: true,
      summary: { ...before, archivedCount: result.archived, activatedCount: result.activated },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '启用下周失败' }, { status: 500 });
  }
}
