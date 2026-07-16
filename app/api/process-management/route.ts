import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  createWorkOrderProcessRoute,
  PROCESS_SHORTCUT_GROUPS,
  processRouteSummaryInclude,
  processTemplateInclude,
  serializeProcessRoute,
  serializeProcessTemplate,
} from '@/lib/process-routing';
import { addDays, parseWeek } from '@/lib/weekly-work-orders';
import type { ProcessRouteStatus, ProcessRouteSummaryDTO } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sameDay(value: Date): { gte: Date; lt: Date } {
  return { gte: value, lt: addDays(value, 1) };
}

function ymd(value: Date | null): string | null {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const get = (type: string): string => parts.find(item => item.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function workOrderInclude() {
  return {
    processRoute: { include: processRouteSummaryInclude },
  } satisfies Prisma.WorkOrderInclude;
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const params = req.nextUrl.searchParams;
    const scope = params.get('scope') === 'history' ? 'history' : 'current';
    const requestedWeek = parseWeek(params.get('weekStart'));
    if (params.get('weekStart') && !requestedWeek) {
      return NextResponse.json({ ok: false, error: '周开始日期格式不正确' }, { status: 400 });
    }
    const activeWeek = requestedWeek || (scope === 'current'
      ? (await prisma.workOrder.findFirst({
          where: {
            deletedAt: null,
            planType: 'weekly_plan',
            planActive: true,
            weekStartDate: { not: null },
          },
          select: { weekStartDate: true },
          orderBy: [{ weekStartDate: 'desc' }, { updatedAt: 'desc' }],
        }))?.weekStartDate || null
      : null);

    const where: Prisma.WorkOrderWhereInput = {
      deletedAt: null,
      planType: 'weekly_plan',
    };
    if (activeWeek) where.weekStartDate = sameDay(activeWeek);
    else if (scope === 'history') where.planActive = false;
    else where.id = '__no_active_process_week__';
    const status = params.get('status');
    if (status === 'missing') where.processRoute = { is: null };
    else if (status === 'active') where.processRoute = { is: { status: { in: ['confirmed', 'in_progress'] } } };
    else if (status && status !== 'all') where.processRoute = { is: { status } };
    const keyword = String(params.get('keyword') || '').trim().slice(0, 160);
    if (keyword) {
      where.OR = [
        { code: { contains: keyword, mode: 'insensitive' } },
        { customerName: { contains: keyword, mode: 'insensitive' } },
        { specification: { contains: keyword, mode: 'insensitive' } },
        { productName: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    const summaryWhere: Prisma.WorkOrderWhereInput = {
      deletedAt: null,
      planType: 'weekly_plan',
      ...(activeWeek
        ? { weekStartDate: sameDay(activeWeek) }
        : scope === 'history'
          ? { planActive: false }
          : { id: '__no_active_process_week__' }),
    };
    const [records, summaryRecords, definitions, allTemplates, weekGroups] = await Promise.all([
      prisma.workOrder.findMany({
        where,
        include: workOrderInclude(),
        orderBy: [{ plannedAt: 'asc' }, { sourceRowNo: 'asc' }, { createdAt: 'asc' }],
        take: 500,
      }),
      prisma.workOrder.findMany({
        where: summaryWhere,
        select: { processRoute: { select: { status: true } } },
      }),
      prisma.processDefinition.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      prisma.processTemplate.findMany({
        where: { isActive: true },
        include: processTemplateInclude,
        orderBy: [{ isDefault: 'desc' }, { templateKey: 'asc' }, { version: 'desc' }],
      }),
      prisma.workOrder.groupBy({
        by: ['weekStartDate', 'weekEndDate', 'planActive'],
        where: { deletedAt: null, planType: 'weekly_plan', weekStartDate: { not: null } },
        _count: { _all: true },
        orderBy: { weekStartDate: 'desc' },
      }),
    ]);
    const latestTemplateMap = new Map<string, (typeof allTemplates)[number]>();
    for (const template of allTemplates) {
      if (!latestTemplateMap.has(template.templateKey)) latestTemplateMap.set(template.templateKey, template);
    }
    const latestTemplates = [...latestTemplateMap.values()];
    const summary = summaryRecords.reduce<ProcessRouteSummaryDTO>((result, item) => {
      result.total += 1;
      if (!item.processRoute) result.missing += 1;
      else if (item.processRoute.status === 'draft') result.draft += 1;
      else if (item.processRoute.status === 'confirmed') result.confirmed += 1;
      else if (item.processRoute.status === 'in_progress') result.inProgress += 1;
      else if (item.processRoute.status === 'completed') result.completed += 1;
      return result;
    }, { total: 0, missing: 0, draft: 0, confirmed: 0, inProgress: 0, completed: 0 });

    return NextResponse.json({
      ok: true,
      summary,
      orders: records.map(order => ({
        id: order.id,
        code: order.code,
        customerName: order.customerName,
        specification: order.specification,
        productName: order.productName,
        stage: order.stage,
        drawingStatus: order.drawingStatus,
        materialStatus: order.materialStatus,
        plannedAt: order.plannedAt?.toISOString() || null,
        deliveryDay: order.deliveryDay,
        weekStartDate: order.weekStartDate?.toISOString() || null,
        weekEndDate: order.weekEndDate?.toISOString() || null,
        planActive: order.planActive,
        route: order.processRoute ? serializeProcessRoute(order.processRoute) : null,
      })),
      definitions: definitions.map(definition => ({
        id: definition.id,
        code: definition.code,
        name: definition.name,
        stageGroup: definition.stageGroup,
        isActive: definition.isActive,
        sortOrder: definition.sortOrder,
      })),
      templates: latestTemplates.map(serializeProcessTemplate),
      shortcutGroups: PROCESS_SHORTCUT_GROUPS,
      selectedWeekStart: ymd(activeWeek),
      weeks: weekGroups
        .filter(item => item.weekStartDate)
        .map(item => ({
          weekStartDate: ymd(item.weekStartDate),
          weekEndDate: ymd(item.weekEndDate),
          active: item.planActive,
          taskCount: item._count._all,
        })),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('process management list failed', error);
    return NextResponse.json({ ok: false, error: '工艺管理数据加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as { workOrderId?: unknown; templateId?: unknown };
    const workOrderId = String(body.workOrderId || '').trim();
    const templateId = String(body.templateId || '').trim() || null;
    if (!workOrderId) return NextResponse.json({ ok: false, error: '请选择工单' }, { status: 400 });
    const result = await prisma.$transaction(async tx => {
      const order = await tx.workOrder.findFirst({
        where: { id: workOrderId, deletedAt: null },
        select: { id: true, planType: true, planActive: true, planClearedAt: true },
      });
      if (!order) throw new Error('WORK_ORDER_NOT_FOUND');
      if (order.planType !== 'weekly_plan' || !order.planActive || order.planClearedAt) {
        throw new Error('WORK_ORDER_READ_ONLY');
      }
      return createWorkOrderProcessRoute(tx, {
        workOrderId,
        templateId,
        actorId: user.id,
      });
    });
    const route = await prisma.workOrderProcessRoute.findUnique({
      where: { id: result.routeId },
      include: processRouteSummaryInclude,
    });
    return NextResponse.json({
      ok: true,
      created: result.created,
      route: route ? serializeProcessRoute(route) : null,
    }, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error && error.message === 'WORK_ORDER_NOT_FOUND') {
      return NextResponse.json({ ok: false, error: '工单不存在' }, { status: 404 });
    }
    if (error instanceof Error && error.message === 'WORK_ORDER_READ_ONLY') {
      return NextResponse.json({ ok: false, error: '只有当前启用周可以创建工艺路线' }, { status: 409 });
    }
    if (error instanceof Error && error.message === 'PROCESS_TEMPLATE_NOT_FOUND') {
      return NextResponse.json({ ok: false, error: '未找到可用工艺模板' }, { status: 409 });
    }
    console.error('create process route failed', error);
    return NextResponse.json({ ok: false, error: '创建工艺路线失败' }, { status: 500 });
  }
}
