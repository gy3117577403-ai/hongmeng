import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { chinaDateKey } from '@/lib/china-date';
import { prisma } from '@/lib/prisma';
import { normalizeWorkOrderStage, serializeWorkOrder } from '@/lib/work-orders';
import { parseWeek } from '@/lib/weekly-work-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function ymd(value?: Date | null) {
  return chinaDateKey(value);
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const keyword = (req.nextUrl.searchParams.get('keyword') || '').trim().toLocaleLowerCase();
    const selectedWeek = parseWeek(req.nextUrl.searchParams.get('weekStartDate'));
    const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') || 1) || 1);
    const pageSize = Math.min(200, Math.max(20, Number(req.nextUrl.searchParams.get('pageSize') || 80) || 80));
    const [categories, workOrders] = await Promise.all([
      prisma.resourceCategory.findMany({ select: { id: true, code: true } }),
      prisma.workOrder.findMany({
        where: {
          deletedAt: null,
          planType: 'weekly_plan',
          planActive: false,
          planClearedAt: { not: null },
        },
        include: {
          resourceFiles: {
            where: { deletedAt: null, status: 'uploaded' },
            select: { categoryId: true },
          },
        },
        orderBy: [{ weekStartDate: 'desc' }, { planClearedAt: 'desc' }, { code: 'asc' }],
      }),
    ]);
    const requiredIds = categories.filter(category => ['drawing', 'sop', 'product'].includes(category.code)).map(category => category.id);
    const groups = new Map<string, typeof workOrders>();
    for (const order of workOrders) {
      const key = ymd(order.weekStartDate) || '未设置计划周';
      const group = groups.get(key) || [];
      group.push(order);
      groups.set(key, group);
    }
    const weeks = Array.from(groups.entries()).map(([weekStartDate, orders]) => {
      const latest = orders.reduce((result, order) => !result || (order.planClearedAt && order.planClearedAt > result.planClearedAt!) ? order : result, orders[0]);
      return {
        weekStartDate,
        weekEndDate: ymd(orders.find(order => order.weekEndDate)?.weekEndDate) || '',
        workOrderCount: orders.length,
        completedCount: orders.filter(order => normalizeWorkOrderStage(order.stage || order.status) === 'completed').length,
        missingCount: orders.filter(order => requiredIds.some(id => !order.resourceFiles.some(file => file.categoryId === id))).length,
        archivedAt: latest?.planClearedAt?.toISOString() || null,
        archivedBy: latest?.planClearedBy || null,
      };
    }).sort((a, b) => b.weekStartDate.localeCompare(a.weekStartDate));

    const selectedKey = selectedWeek ? ymd(selectedWeek) : weeks[0]?.weekStartDate || '';
    const selectedOrders = groups.get(selectedKey) || [];
    const filtered = selectedOrders.filter(order => !keyword || [
      order.code,
      order.specification,
      order.customerName,
      order.productName,
      order.sourceOrderNo,
    ].some(value => String(value || '').toLocaleLowerCase().includes(keyword)));
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize).map(order => {
      const missingCategoryCount = requiredIds.filter(id => !order.resourceFiles.some(file => file.categoryId === id)).length;
      return {
        ...serializeWorkOrder(order),
        missingCategoryCount,
        completenessText: missingCategoryCount ? `缺 ${missingCategoryCount} 类` : '必填资料齐全',
      };
    });

    return NextResponse.json({
      ok: true,
      data: {
        weeks,
        selectedWeekStart: selectedKey || null,
        workOrders: paged,
        pagination: { page: safePage, pageSize, total, totalPages },
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '历史周加载失败' }, { status: 500 });
  }
}
