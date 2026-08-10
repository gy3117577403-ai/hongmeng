import { MaterialFollowUpStatus, Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  chinaDayStart,
  MATERIAL_FOLLOW_UP_ACTIVE_STATUSES,
  materialFollowUpListInclude,
  serializeMaterialFollowUpTask,
} from '@/lib/material-follow-up';
import { prisma } from '@/lib/prisma';
import { naturalProductionWeek } from '@/lib/production-execution';
import {
  warehouseMaterialScopeWeekStart,
  warehouseMaterialWorkOrderWhere,
  type WarehouseMaterialScope,
} from '@/lib/warehouse-material';
import { addDays, parseWeek } from '@/lib/weekly-work-orders';
import type { MaterialFollowUpStatusDTO, MaterialFollowUpSummaryDTO } from '@/types';
import {
  loadProductionCarryoverMetadata,
  reconcileCurrentProductionCarryovers,
} from '@/lib/production-carryovers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const validStatuses = new Set([...Object.values(MaterialFollowUpStatus), 'ACTIVE', 'ALL']);

function integer(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), max) : fallback;
}

function ymd(value: Date | null): string | null {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const get = (type: string): string => parts.find(item => item.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function requestedScope(value: string | null): WarehouseMaterialScope {
  if (value === 'history') return 'history';
  if (value === 'preparation') return 'preparation';
  return 'current';
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const params = req.nextUrl.searchParams;
    const status = String(params.get('status') || 'ACTIVE').trim().toUpperCase();
    const owner = String(params.get('owner') || '').trim();
    const keyword = String(params.get('keyword') || '').trim().slice(0, 100);
    const scope = requestedScope(params.get('scope'));
    const requestedWeek = parseWeek(params.get('weekStart'));
    if (!validStatuses.has(status)) {
      return NextResponse.json({ ok: false, error: '跟进状态筛选不正确' }, { status: 400 });
    }
    if (params.get('weekStart') && !requestedWeek) {
      return NextResponse.json({ ok: false, error: '周开始日期格式不正确' }, { status: 400 });
    }

    const naturalWeek = naturalProductionWeek();
    if (scope === 'current') {
      await reconcileCurrentProductionCarryovers({ targetWeekStart: naturalWeek.start, actorId: user.id });
    }
    const nextWeekStart = addDays(naturalWeek.start, 7);
    if (requestedWeek && scope === 'history' && requestedWeek >= naturalWeek.start) {
      return NextResponse.json({ ok: false, error: '历史周只能选择本周以前的生产周' }, { status: 400 });
    }
    if (requestedWeek && scope === 'preparation' && requestedWeek < nextWeekStart) {
      return NextResponse.json({ ok: false, error: '下周范围只能选择下周及以后的预备周' }, { status: 400 });
    }

    const activeWeek = warehouseMaterialScopeWeekStart(scope, naturalWeek.start, requestedWeek);
    const workOrderWhere = warehouseMaterialWorkOrderWhere({
      scope,
      currentWeekStart: naturalWeek.start,
      requestedWeekStart: requestedWeek,
    });
    const scopeWhere: Prisma.MaterialFollowUpTaskWhereInput = {
      warehouseTask: { workOrder: { is: workOrderWhere } },
    };
    const filters: Prisma.MaterialFollowUpTaskWhereInput[] = [scopeWhere];
    if (status === 'ACTIVE') {
      filters.push({ status: { in: MATERIAL_FOLLOW_UP_ACTIVE_STATUSES } });
    } else if (status !== 'ALL') {
      filters.push({ status: status as MaterialFollowUpStatus });
    }
    if (owner === 'unassigned') filters.push({ ownerId: null });
    else if (owner) filters.push({ ownerId: owner });
    if (keyword) {
      filters.push({
        OR: [
          { latestProgress: { contains: keyword, mode: 'insensitive' } },
          { warehouseException: { exceptionNote: { contains: keyword, mode: 'insensitive' } } },
          { warehouseTask: { workOrder: { code: { contains: keyword, mode: 'insensitive' } } } },
          { warehouseTask: { workOrder: { customerName: { contains: keyword, mode: 'insensitive' } } } },
          { warehouseTask: { workOrder: { specification: { contains: keyword, mode: 'insensitive' } } } },
          { warehouseTask: { workOrder: { productName: { contains: keyword, mode: 'insensitive' } } } },
        ],
      });
    }
    const where: Prisma.MaterialFollowUpTaskWhereInput = { AND: filters };
    const page = integer(params.get('page'), 1, 100000);
    const pageSize = integer(params.get('pageSize'), 100, 300);
    const weekOptionsWhere: Prisma.WorkOrderWhereInput = {
      deletedAt: null,
      planType: { in: ['weekly_plan', 'managed_plan'] },
      materialTask: { is: { followUpTasks: { some: {} } } },
      ...(scope === 'current'
        ? warehouseMaterialWorkOrderWhere({ scope: 'current', currentWeekStart: naturalWeek.start })
        : scope === 'preparation'
          ? {
              planActive: false,
              productionPlanBatch: { is: { releaseState: 'preparation', deletedAt: null } },
              weekStartDate: { gte: nextWeekStart },
            }
          : { weekStartDate: { lt: naturalWeek.start } }),
    };

    const [tasks, total, grouped, overdue, unassigned, users, weekGroups] = await Promise.all([
      prisma.materialFollowUpTask.findMany({
        where,
        include: materialFollowUpListInclude,
        orderBy: status === 'RESOLVED'
          ? [{ resolvedAt: 'desc' }, { updatedAt: 'desc' }]
          : [{ expectedAt: 'asc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.materialFollowUpTask.count({ where }),
      prisma.materialFollowUpTask.groupBy({
        by: ['status'],
        where: scopeWhere,
        _count: { _all: true },
        orderBy: { status: 'asc' },
      }),
      prisma.materialFollowUpTask.count({
        where: {
          ...scopeWhere,
          status: { in: MATERIAL_FOLLOW_UP_ACTIVE_STATUSES },
          expectedAt: { lt: chinaDayStart() },
        },
      }),
      prisma.materialFollowUpTask.count({
        where: {
          ...scopeWhere,
          status: { in: MATERIAL_FOLLOW_UP_ACTIVE_STATUSES },
          ownerId: null,
        },
      }),
      prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, username: true, displayName: true },
        orderBy: [{ displayName: 'asc' }, { username: 'asc' }],
      }),
      prisma.workOrder.groupBy({
        by: ['weekStartDate', 'weekEndDate', 'planActive'],
        where: weekOptionsWhere,
        _count: { _all: true },
        orderBy: { weekStartDate: 'desc' },
      }),
    ]);

    const counts = new Map<MaterialFollowUpStatusDTO, number>();
    grouped.forEach(item => counts.set(item.status as MaterialFollowUpStatusDTO, item._count._all));
    const activeTotal = MATERIAL_FOLLOW_UP_ACTIVE_STATUSES.reduce(
      (sum, itemStatus) => sum + (counts.get(itemStatus as MaterialFollowUpStatusDTO) || 0),
      0,
    );
    const summary: MaterialFollowUpSummaryDTO = {
      total: activeTotal,
      pending: counts.get('PENDING') || 0,
      inProgress: counts.get('IN_PROGRESS') || 0,
      waitingArrival: counts.get('WAITING_ARRIVAL') || 0,
      waitingWarehouse: counts.get('WAITING_WAREHOUSE') || 0,
      resolved: counts.get('RESOLVED') || 0,
      overdue,
      unassigned,
    };

    const weeksByStart = new Map<string, {
      weekStartDate: string;
      weekEndDate: string | null;
      active: boolean;
      taskCount: number;
    }>();
    for (const item of weekGroups) {
      const weekStartDate = ymd(item.weekStartDate);
      if (!weekStartDate) continue;
      const existing = weeksByStart.get(weekStartDate);
      if (existing) {
        existing.active = existing.active || item.planActive;
        existing.taskCount += item._count._all;
        if (!existing.weekEndDate) existing.weekEndDate = ymd(item.weekEndDate);
      } else {
        weeksByStart.set(weekStartDate, {
          weekStartDate,
          weekEndDate: ymd(item.weekEndDate),
          active: item.planActive,
          taskCount: item._count._all,
        });
      }
    }
    const weeks = [...weeksByStart.values()].sort((first, second) => (
      scope === 'preparation'
        ? first.weekStartDate.localeCompare(second.weekStartDate)
        : second.weekStartDate.localeCompare(first.weekStartDate)
    ));
    const carryoverByWorkOrder = scope === 'current'
      ? await loadProductionCarryoverMetadata(
          naturalWeek.start,
          tasks.map(task => task.warehouseTask.workOrder.id),
        )
      : new Map();

    return NextResponse.json({
      ok: true,
      tasks: tasks.map(task => {
        const carryover = carryoverByWorkOrder.get(task.warehouseTask.workOrder.id);
        return {
          ...serializeMaterialFollowUpTask(task),
          carryover: carryover
            ? {
                label: carryover.inclusionType === 'MANUAL_OLDER_WEEK' ? '更早遗留' as const : '上周遗留' as const,
                originalWeekStartDate: carryover.originalWeekStartDate,
              }
            : null,
        };
      }),
      summary,
      users,
      selectedWeekStart: ymd(activeWeek),
      weeks,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('material follow-up list failed', error);
    return NextResponse.json({ ok: false, error: '物料异常跟进任务加载失败' }, { status: 500 });
  }
}
