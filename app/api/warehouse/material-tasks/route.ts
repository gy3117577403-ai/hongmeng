import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { addDays, parseWeek } from '@/lib/weekly-work-orders';
import {
  WAREHOUSE_EXCEPTION_TYPES,
  WAREHOUSE_MATERIAL_STATUSES,
  serializeWarehouseMaterialTask,
  warehouseMaterialTaskListInclude,
} from '@/lib/warehouse-material';
import type { WarehouseExceptionType, WarehouseMaterialStatus } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function integer(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), max) : fallback;
}

function sameDay(value: Date): { gte: Date; lt: Date } {
  return { gte: value, lt: addDays(value, 1) };
}

function chinaDayStart(value = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: string): number => Number(parts.find(item => item.type === type)?.value || 0);
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day'), -8));
}

function ymd(value: Date | null): string | null {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const get = (type: string): string => parts.find(item => item.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const params = req.nextUrl.searchParams;
    const scope = params.get('scope') === 'history'
      ? 'history'
      : params.get('scope') === 'preparation'
        ? 'preparation'
        : 'current';
    const requestedWeek = parseWeek(params.get('weekStart'));
    if (params.get('weekStart') && !requestedWeek) {
      return NextResponse.json({ ok: false, error: '周开始日期格式不正确' }, { status: 400 });
    }

    let activeWeek = requestedWeek;
    if (!activeWeek && scope === 'current') {
      activeWeek = (await prisma.workOrder.findFirst({
        where: { deletedAt: null, planType: { in: ['weekly_plan', 'managed_plan'] }, planActive: true, materialTask: { isNot: null }, weekStartDate: { not: null } },
        select: { weekStartDate: true },
        orderBy: [{ weekStartDate: 'desc' }, { updatedAt: 'desc' }],
      }))?.weekStartDate || null;
    }
    if (!activeWeek && scope === 'preparation') {
      const preparationWeek = (await prisma.workOrder.findFirst({
        where: {
          deletedAt: null,
          planType: 'managed_plan',
          planActive: false,
          productionPlanBatch: { is: { releaseState: 'preparation', deletedAt: null } },
          materialTask: { isNot: null },
          weekStartDate: { not: null },
        },
        select: { weekStartDate: true },
        orderBy: [{ weekStartDate: 'asc' }, { updatedAt: 'desc' }],
      }))?.weekStartDate || null;
      if (preparationWeek) {
        activeWeek = preparationWeek;
      } else {
        const currentWeek = (await prisma.workOrder.findFirst({
          where: { deletedAt: null, planType: { in: ['weekly_plan', 'managed_plan'] }, planActive: true, materialTask: { isNot: null }, weekStartDate: { not: null } },
          select: { weekStartDate: true },
          orderBy: [{ weekStartDate: 'desc' }, { updatedAt: 'desc' }],
        }))?.weekStartDate || null;
        activeWeek = currentWeek ? addDays(currentWeek, 7) : null;
      }
    }

    const workOrderWhere: Prisma.WorkOrderWhereInput = {
      deletedAt: null,
      planType: { in: ['weekly_plan', 'managed_plan'] },
    };
    if (activeWeek) workOrderWhere.weekStartDate = sameDay(activeWeek);
    if (scope === 'current') {
      workOrderWhere.planActive = true;
      if (!activeWeek) workOrderWhere.id = '__no_active_warehouse_week__';
    }
    else if (scope === 'preparation') {
      workOrderWhere.planActive = false;
      workOrderWhere.productionPlanBatch = { is: { releaseState: 'preparation', deletedAt: null } };
      if (!activeWeek) workOrderWhere.id = '__no_preparation_warehouse_week__';
    } else workOrderWhere.planActive = false;

    const summaryWhere: Prisma.WarehouseMaterialTaskWhereInput = { workOrder: { is: workOrderWhere } };
    const where: Prisma.WarehouseMaterialTaskWhereInput = { ...summaryWhere };
    const status = params.get('status');
    const exceptionType = params.get('exceptionType');
    const keyword = String(params.get('keyword') || '').trim().slice(0, 160);
    if (status && status !== 'all') {
      if (!WAREHOUSE_MATERIAL_STATUSES.includes(status as WarehouseMaterialStatus)) {
        return NextResponse.json({ ok: false, error: '配料状态筛选不正确' }, { status: 400 });
      }
      where.status = status;
    }
    if (exceptionType && exceptionType !== 'all') {
      if (!WAREHOUSE_EXCEPTION_TYPES.includes(exceptionType as WarehouseExceptionType)) {
        return NextResponse.json({ ok: false, error: '异常类型筛选不正确' }, { status: 400 });
      }
      where.exceptionType = exceptionType;
    }
    if (params.get('expected') === 'overdue') {
      where.status = 'exception';
      where.expectedAt = { lt: chinaDayStart() };
    }
    if (keyword) {
      where.OR = [
        { exceptionNote: { contains: keyword, mode: 'insensitive' } },
        { workOrder: { code: { contains: keyword, mode: 'insensitive' } } },
        { workOrder: { customerName: { contains: keyword, mode: 'insensitive' } } },
        { workOrder: { specification: { contains: keyword, mode: 'insensitive' } } },
        { workOrder: { productName: { contains: keyword, mode: 'insensitive' } } },
      ];
    }

    const page = integer(params.get('page'), 1, 100000);
    const pageSize = integer(params.get('pageSize'), 100, 300);
    const [records, total, grouped, expectedOverdue, weekGroups] = await Promise.all([
      prisma.warehouseMaterialTask.findMany({
        where,
        include: warehouseMaterialTaskListInclude,
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.warehouseMaterialTask.count({ where }),
      prisma.warehouseMaterialTask.groupBy({ by: ['status'], where: summaryWhere, _count: { _all: true } }),
      prisma.warehouseMaterialTask.count({
        where: { ...summaryWhere, status: 'exception', expectedAt: { lt: chinaDayStart() } },
      }),
      prisma.workOrder.groupBy({
        by: ['weekStartDate', 'weekEndDate', 'planActive'],
        where: { deletedAt: null, planType: { in: ['weekly_plan', 'managed_plan'] }, weekStartDate: { not: null }, materialTask: { isNot: null } },
        _count: { _all: true },
        orderBy: { weekStartDate: 'desc' },
      }),
    ]);
    const counts = new Map(grouped.map(item => [item.status, item._count._all]));
    const summary = {
      total: [...counts.values()].reduce((sum, value) => sum + value, 0),
      pending: counts.get('pending') || 0,
      completed: counts.get('completed') || 0,
      exception: counts.get('exception') || 0,
      expectedOverdue,
    };

    return NextResponse.json({
      ok: true,
      tasks: records.map(record => serializeWarehouseMaterialTask(record)),
      summary,
      selectedWeekStart: ymd(activeWeek),
      weeks: weekGroups
        .filter(item => item.weekStartDate)
        .map(item => ({
          weekStartDate: ymd(item.weekStartDate),
          weekEndDate: ymd(item.weekEndDate),
          active: item.planActive,
          taskCount: item._count._all,
        })),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('warehouse material task list failed', error);
    return NextResponse.json({ ok: false, error: '仓库配料任务加载失败' }, { status: 500 });
  }
}
