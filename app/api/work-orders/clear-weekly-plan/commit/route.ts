import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { parseClearWeek, summarizeWeeklyPlanClear, weeklyPlanWhere } from '../shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const weekStartDate = parseClearWeek(body.weekStartDate);
    if (!weekStartDate) return NextResponse.json({ ok: false, error: '请选择有效的周开始日期' }, { status: 400 });

    const confirmText = String(body.confirmText || '').trim();
    if (confirmText !== 'CLEAR_WEEK') {
      return NextResponse.json({ ok: false, error: '请输入 CLEAR_WEEK 确认清除本周生产工单' }, { status: 400 });
    }

    const before = await summarizeWeeklyPlanClear(weekStartDate);
    if (before.incompleteWorkOrderCount > 0) {
      return NextResponse.json({
        ok: false,
        error: `仍有 ${before.incompleteWorkOrderCount} 张工单或分支未闭环，不能归档当前周`,
        summary: before,
      }, { status: 409 });
    }
    const result = await prisma.workOrder.updateMany({
      where: weeklyPlanWhere(weekStartDate),
      data: {
        planActive: false,
        planClearedAt: new Date(),
        planClearedBy: user.displayName || user.username,
      },
    });

    await logOp({
      userId: user.id,
      action: 'clear_weekly_plan_work_orders',
      targetType: 'work_order',
      detail: {
        weekStartDate: before.weekStartDate,
        weekEndDate: before.weekEndDate,
        clearedWorkOrders: result.count,
        workOrdersWithFiles: before.workOrdersWithFiles,
        preservedFiles: before.fileCount,
        preservedConnectorParameters: before.connectorParameterCount,
      },
    });

    return NextResponse.json({ ok: true, summary: { ...before, clearedCount: result.count } });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '清除本周生产工单失败' }, { status: 500 });
  }
}
