import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { addDays, parseWeek } from '@/lib/weekly-work-orders';
import {
  WAREHOUSE_EXCEPTION_TYPES,
  WAREHOUSE_MATERIAL_STATUSES,
  serializeWarehouseMaterialTask,
  warehouseMaterialScopeWeekStart,
  warehouseMaterialWorkOrderWhere,
  warehouseMaterialTaskListInclude,
} from '@/lib/warehouse-material';
import type { WarehouseExceptionType, WarehouseMaterialStatus } from '@/types';
import { naturalProductionWeek } from '@/lib/production-execution';
import {
  loadProductionCarryoverMetadata,
  reconcileCurrentProductionCarryovers,
} from '@/lib/production-carryovers';
import { MATERIAL_SOURCES } from '@/lib/material-source';
import { canRunGetReconciliation } from '@/lib/get-reconciliation-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function integer(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), max) : fallback;
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

function overdueTaskWhere(): Prisma.WarehouseMaterialTaskWhereInput {
  const beforeToday = { lt: chinaDayStart() };
  return {
    status: 'exception',
    OR: [
      {
        exceptionCases: {
          some: {
            status: 'OPEN',
            expectedArrivalAt: beforeToday,
            OR: [
              { followUpTask: { is: null } },
              { followUpTask: { is: { status: { not: 'WAITING_WAREHOUSE' } } } },
            ],
          },
        },
      },
      {
        exceptionCases: { none: { status: 'OPEN' } },
        expectedAt: beforeToday,
      },
    ],
  };
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const params = req.nextUrl.searchParams;
    const scope = params.get('scope') === 'history'
      ? 'history'
      : params.get('scope') === 'preparation'
        ? 'preparation'
        : params.get('scope') === 'open' ? 'open' : 'current';
    const requestedWeek = parseWeek(params.get('weekStart'));
    if (params.get('weekStart') && !requestedWeek) {
      return NextResponse.json({ ok: false, error: '周开始日期格式不正确' }, { status: 400 });
    }
    const naturalWeek = naturalProductionWeek();
    if ((scope === 'current' || scope === 'open') && canRunGetReconciliation(user.access, ['WAREHOUSE'])) {
      await reconcileCurrentProductionCarryovers({ targetWeekStart: naturalWeek.start, actorId: user.id });
    }
    const nextWeekStart = addDays(naturalWeek.start, 7);
    if (requestedWeek && scope === 'history' && requestedWeek >= naturalWeek.start) {
      return NextResponse.json({ ok: false, error: '历史周只能选择本周以前的生产周' }, { status: 400 });
    }
    if (requestedWeek && scope === 'preparation' && requestedWeek < nextWeekStart) {
      return NextResponse.json({ ok: false, error: '预备周只能选择下周及以后的生产周' }, { status: 400 });
    }
    const activeWeek = warehouseMaterialScopeWeekStart(scope, naturalWeek.start, requestedWeek);
    const workOrderWhere = warehouseMaterialWorkOrderWhere({
      scope,
      currentWeekStart: naturalWeek.start,
      requestedWeekStart: requestedWeek,
    });

    // Sample warehouse workbench reads its own tasks by task id; this endpoint stays production-scoped.
    const summaryWhere: Prisma.WarehouseMaterialTaskWhereInput = { workOrder: { is: workOrderWhere } };
    const where: Prisma.WarehouseMaterialTaskWhereInput = { ...summaryWhere };
    const source = params.get('source') || 'ALL';
    if (source !== 'ALL' && !MATERIAL_SOURCES.includes(source as never)) return NextResponse.json({ ok: false, error: '物料来源筛选不正确' }, { status: 400 });
    const eventFilter: Prisma.WarehouseMaterialExceptionCaseWhereInput = { status: 'OPEN' };
    if (source !== 'ALL') eventFilter.supplySource = source;
    const status = params.get('status');
    const exceptionType = params.get('exceptionType');
    const keyword = String(params.get('keyword') || '').trim().slice(0, 160);
    const waitingWhere: Prisma.WarehouseMaterialTaskWhereInput = { exceptionCases: { some: { status: 'OPEN', followUpTask: { is: { status: 'WAITING_WAREHOUSE' } } } } };
    const unassignedWhere: Prisma.WarehouseMaterialTaskWhereInput = { exceptionCases: { some: { status: 'OPEN', OR: [{ followUpTask: { is: null } }, { followUpTask: { is: { ownerId: null } } }] } } };
    if (status === 'active') {
      where.status = { in: ['pending', 'exception'] };
    } else if (status === 'waiting' || status === 'unassigned') {
      where.AND = [status === 'waiting' ? waitingWhere : unassignedWhere];
    } else if (status && status !== 'all') {
      if (!WAREHOUSE_MATERIAL_STATUSES.includes(status as WarehouseMaterialStatus)) {
        return NextResponse.json({ ok: false, error: '配料状态筛选不正确' }, { status: 400 });
      }
      where.status = status;
    }
    if (exceptionType && exceptionType !== 'all') {
      if (!WAREHOUSE_EXCEPTION_TYPES.includes(exceptionType as WarehouseExceptionType)) {
        return NextResponse.json({ ok: false, error: '异常类型筛选不正确' }, { status: 400 });
      }
      eventFilter.exceptionType = exceptionType;
    }
    if (source !== 'ALL' || (exceptionType && exceptionType !== 'all')) where.exceptionCases = { some: eventFilter };
    if (params.get('expected') === 'overdue') {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), overdueTaskWhere()];
    }
    if (keyword) {
      where.OR = [
        { exceptionNote: { contains: keyword, mode: 'insensitive' } },
        { exceptionCases: { some: { materialModel: { contains: keyword, mode: 'insensitive' } } } },
        { workOrder: { code: { contains: keyword, mode: 'insensitive' } } },
        { workOrder: { customerName: { contains: keyword, mode: 'insensitive' } } },
        { workOrder: { specification: { contains: keyword, mode: 'insensitive' } } },
        { workOrder: { productName: { contains: keyword, mode: 'insensitive' } } },
      ];
    }
    // Counters use the same search/source scope as the queue, never just its current page.
    if (where.OR) summaryWhere.OR = where.OR;
    if (where.exceptionCases) summaryWhere.exceptionCases = where.exceptionCases;
    if (params.get('expected') === 'overdue') summaryWhere.AND = [overdueTaskWhere()];

    const page = integer(params.get('page'), 1, 100000);
    const pageSize = integer(params.get('pageSize'), 100, 300);
    const planEvidence: Prisma.WorkOrderWhereInput = {
      OR: [
        { planType: { in: ['weekly_plan', 'managed_plan'] } },
        { productionPlanBatch: { is: { deletedAt: null, planOrder: { deletedAt: null } } } },
      ],
    };
    const weekScope: Prisma.WorkOrderWhereInput = scope === 'current' || scope === 'open'
      ? warehouseMaterialWorkOrderWhere({ scope, currentWeekStart: naturalWeek.start })
      : scope === 'preparation'
        ? {
            planActive: false,
            productionPlanBatch: { is: { releaseState: 'preparation', deletedAt: null } },
            weekStartDate: { gte: nextWeekStart },
          }
        : { weekStartDate: { lt: naturalWeek.start } };
    const weekOptionsWhere: Prisma.WorkOrderWhereInput = {
      AND: [
        { deletedAt: null },
        { materialTask: { isNot: null } },
        planEvidence,
        weekScope,
      ],
    };
    const [records, total, grouped, expectedOverdue, weekGroups, waiting, unassigned] = await Promise.all([
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
        where: { ...summaryWhere, AND: [overdueTaskWhere()] },
      }),
      prisma.workOrder.groupBy({
        by: ['weekStartDate', 'weekEndDate', 'planActive'],
        where: weekOptionsWhere,
        _count: { _all: true },
        orderBy: { weekStartDate: 'desc' },
      }),
      prisma.warehouseMaterialTask.count({ where: { ...summaryWhere, AND: [waitingWhere] } }),
      prisma.warehouseMaterialTask.count({ where: { ...summaryWhere, AND: [unassignedWhere] } }),
    ]);
    const counts = new Map(grouped.map(item => [item.status, item._count._all]));
    const summary = {
      total: [...counts.values()].reduce((sum, value) => sum + value, 0),
      pending: counts.get('pending') || 0,
      completed: counts.get('completed') || 0,
      exception: counts.get('exception') || 0,
      expectedOverdue,
      waiting,
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
    const carryoverByWorkOrder = scope === 'current' || scope === 'open'
      ? await loadProductionCarryoverMetadata(naturalWeek.start, records.flatMap(record => record.workOrder ? [record.workOrder.id] : []))
      : new Map();

    return NextResponse.json({
      ok: true,
      tasks: records.map(record => {
        const carryover = carryoverByWorkOrder.get(record.workOrder?.id || '');
        return {
          ...serializeWarehouseMaterialTask(record),
          carryover: carryover
            ? {
                label: carryover.inclusionType === 'MANUAL_OLDER_WEEK' ? '更早遗留' as const : '上周遗留' as const,
                originalWeekStartDate: carryover.originalWeekStartDate,
              }
            : null,
        };
      }),
      summary,
      selectedWeekStart: ymd(activeWeek),
      weeks,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('warehouse material task list failed', error);
    return NextResponse.json({ ok: false, error: '仓库配料任务加载失败' }, { status: 500 });
  }
}
