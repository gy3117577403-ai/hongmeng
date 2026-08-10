import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { findDrawingLibraryItemForWorkOrder } from '@/lib/drawing-library';
import { normalizeWorkOrderStage, parseWorkOrderBody, serializeWorkOrder } from '@/lib/work-orders';
import { snapshotChange, workOrderSnapshot } from '@/lib/change-snapshots';
import { createWorkOrderProcessRoute } from '@/lib/process-routing';
import { allocateBusinessWorkOrderCode } from '@/lib/work-order-business-code';
import { productionWorkOrderScopeWhere } from '@/lib/production-execution';
import {
  ProductionAccessScopeError,
  resolveProductionEntityScope,
} from '@/lib/production-access-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function chinaDayStart(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: string) => parts.find(item => item.type === type)?.value || '0';
  return new Date(Date.UTC(Number(part('year')), Number(part('month')) - 1, Number(part('day')), -8));
}

function filterDate(filter: string | null) {
  if (filter === 'today') {
    return { gte: chinaDayStart() };
  }
  if (filter === 'week') {
    const start = chinaDayStart();
    start.setUTCDate(start.getUTCDate() - 6);
    return { gte: start };
  }
  return undefined;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const productionScope = resolveProductionEntityScope(user);
    const keyword = req.nextUrl.searchParams.get('keyword')?.trim();
    const filter = req.nextUrl.searchParams.get('filter');
    const includeCleared = req.nextUrl.searchParams.get('includeCleared') === 'true';
    const planView = req.nextUrl.searchParams.get('planView') || 'current';
    const stage = normalizeWorkOrderStage(filter);
    const createdAt = filterDate(filter);
    const and: Prisma.WorkOrderWhereInput[] = [];
    if (keyword) {
      and.push({
        OR: [
          { code: { contains: keyword, mode: 'insensitive' } },
          { productName: { contains: keyword, mode: 'insensitive' } },
          { customerName: { contains: keyword, mode: 'insensitive' } },
          { specification: { contains: keyword, mode: 'insensitive' } },
          { sourceOrderNo: { contains: keyword, mode: 'insensitive' } },
          { salesperson: { contains: keyword, mode: 'insensitive' } },
          { remark: { contains: keyword, mode: 'insensitive' } },
        ],
      });
    }
    if (stage) {
      const legacyStages = stage === 'frontend'
        ? ['前端', 'frontend', 'processing']
        : stage === 'backend'
          ? ['后端', 'backend']
          : stage === 'completed'
            ? ['已完成', 'completed', 'done']
            : ['未发图', 'not_issued', 'pending'];
      and.push({ OR: [{ stage }, { stage: { in: legacyStages } }] });
    }
    if (createdAt) and.push({ createdAt });
    if (!includeCleared) {
      if (planView === 'draft_next') {
        and.push({ planType: 'weekly_plan', planActive: false, planClearedAt: null });
      } else if (planView === 'history') {
        and.push({ planType: 'weekly_plan', planActive: false, planClearedAt: { not: null } });
      } else {
        and.push({ planActive: true });
      }
    }

    const workOrders = await prisma.workOrder.findMany({
      where: {
        deletedAt: null,
        ...(user.access.productionScope === 'TEAM' ? productionWorkOrderScopeWhere(productionScope) : {}),
        ...(and.length ? { AND: and } : {}),
      },
      include: {
        resourceFiles: { where: { deletedAt: null, status: 'uploaded' }, select: { categoryId: true } },
      },
      orderBy: planView === 'history'
        ? [{ weekStartDate: 'desc' }, { createdAt: 'desc' }, { code: 'asc' }]
        : [{ createdAt: 'desc' }, { code: 'asc' }],
    });

    return NextResponse.json({ workOrders: workOrders.map(serializeWorkOrder) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    if (e instanceof ProductionAccessScopeError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ message: '工单加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const productionScope = resolveProductionEntityScope(user);
    if (user.access.productionScope === 'TEAM') {
      return NextResponse.json({ ok: false, error: '班组长不能创建未归属班组的工单' }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const { data, errors } = parseWorkOrderBody(body);
    if (errors.length) return NextResponse.json({ ok: false, error: errors[0], message: errors[0] }, { status: 400 });

    const drawingLibraryItem = await findDrawingLibraryItemForWorkOrder({
      customerName: data.customerName === null ? null : String(data.customerName || ''),
      specification: typeof data.specification === 'string' ? data.specification : null,
    });
    const workOrder = await prisma.$transaction(async tx => {
      const businessCode = await allocateBusinessWorkOrderCode(tx, {
        specification: typeof data.specification === 'string' ? data.specification : null,
        productName: String(data.productName),
        plannedAt: data.plannedAt instanceof Date ? data.plannedAt : null,
      });
      const created = await tx.workOrder.create({
        data: {
          code: String(data.code),
          businessCode,
          customerName: data.customerName === null ? null : String(data.customerName || ''),
          productName: String(data.productName),
          stage: String(data.stage),
          priority: String(data.priority),
          status: String(data.status),
          progress: Number(data.progress),
          plannedAt: data.plannedAt instanceof Date ? data.plannedAt : null,
          remark: data.remark === null ? null : String(data.remark || ''),
          specification: typeof data.specification === 'string' ? data.specification : null,
          sourceOrderNo: typeof data.sourceOrderNo === 'string' ? data.sourceOrderNo : null,
          salesperson: typeof data.salesperson === 'string' ? data.salesperson : null,
          planType: 'manual',
          planActive: true,
          libraryKey: typeof data.libraryKey === 'string' && data.libraryKey
            ? data.libraryKey
            : (typeof data.specification === 'string' && data.specification ? data.specification : String(data.code)),
          drawingLibraryItemId: drawingLibraryItem?.id || null,
        },
        include: {
          resourceFiles: { where: { deletedAt: null, status: 'uploaded' }, select: { categoryId: true } },
        },
      });
      await createWorkOrderProcessRoute(tx, { workOrderId: created.id, actorId: user.id });
      return created;
    });

    await logOp({ userId: user.id, action: 'create_work_order', targetType: 'work_order', targetId: workOrder.id, detail: { code: workOrder.code } });
    await snapshotChange({
      entityType: 'work_order',
      entityId: workOrder.id,
      action: 'create_work_order',
      after: workOrderSnapshot(workOrder),
      changedBy: user.displayName || user.username,
    });
    return NextResponse.json({ ok: true, workOrder: serializeWorkOrder(workOrder) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    if (e instanceof ProductionAccessScopeError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: e.status });
    }
    if ((e as { code?: string }).code === 'P2002') return NextResponse.json({ ok: false, error: '工单号已存在', message: '工单号已存在' }, { status: 409 });
    console.error(e);
    return NextResponse.json({ ok: false, error: '新建工单失败', message: '新建工单失败' }, { status: 500 });
  }
}
