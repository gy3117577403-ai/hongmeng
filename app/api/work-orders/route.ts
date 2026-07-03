import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { normalizeWorkOrderStage, parseWorkOrderBody, serializeWorkOrder } from '@/lib/work-orders';
import { snapshotChange, workOrderSnapshot } from '@/lib/change-snapshots';

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
    await requireUser();
    const keyword = req.nextUrl.searchParams.get('keyword')?.trim();
    const filter = req.nextUrl.searchParams.get('filter');
    const stage = normalizeWorkOrderStage(filter);
    const createdAt = filterDate(filter);
    const and: Prisma.WorkOrderWhereInput[] = [];
    if (keyword) {
      and.push({ OR: [{ code: { contains: keyword, mode: 'insensitive' } }, { productName: { contains: keyword, mode: 'insensitive' } }, { customerName: { contains: keyword, mode: 'insensitive' } }] });
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

    const workOrders = await prisma.workOrder.findMany({
      where: {
        deletedAt: null,
        ...(and.length ? { AND: and } : {}),
      },
      include: {
        resourceFiles: { where: { deletedAt: null, status: 'uploaded' }, select: { categoryId: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { code: 'asc' }],
    });

    return NextResponse.json({ workOrders: workOrders.map(serializeWorkOrder) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ message: '工单加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const { data, errors } = parseWorkOrderBody(body);
    if (errors.length) return NextResponse.json({ ok: false, error: errors[0], message: errors[0] }, { status: 400 });

    const workOrder = await prisma.workOrder.create({
      data: {
        code: String(data.code),
        customerName: data.customerName === null ? null : String(data.customerName || ''),
        productName: String(data.productName),
        stage: String(data.stage),
        priority: String(data.priority),
        status: String(data.status),
        progress: Number(data.progress),
        plannedAt: data.plannedAt instanceof Date ? data.plannedAt : null,
        remark: data.remark === null ? null : String(data.remark || ''),
      },
      include: {
        resourceFiles: { where: { deletedAt: null, status: 'uploaded' }, select: { categoryId: true } },
      },
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
    if ((e as { code?: string }).code === 'P2002') return NextResponse.json({ ok: false, error: '工单号已存在', message: '工单号已存在' }, { status: 409 });
    console.error(e);
    return NextResponse.json({ ok: false, error: '新建工单失败', message: '新建工单失败' }, { status: 500 });
  }
}
