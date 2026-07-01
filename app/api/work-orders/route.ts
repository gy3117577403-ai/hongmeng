import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { parseWorkOrderBody, serializeWorkOrder } from '@/lib/work-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function filterDate(filter: string | null) {
  const now = new Date();
  if (filter === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { gte: start };
  }
  if (filter === 'week') {
    const start = new Date(now);
    start.setDate(now.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return { gte: start };
  }
  return undefined;
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const keyword = req.nextUrl.searchParams.get('keyword')?.trim();
    const filter = req.nextUrl.searchParams.get('filter');
    const status = filter === 'done' ? 'done' : filter === 'processing' ? 'processing' : null;
    const createdAt = filterDate(filter);

    const workOrders = await prisma.workOrder.findMany({
      where: {
        deletedAt: null,
        ...(keyword ? { OR: [{ code: { contains: keyword, mode: 'insensitive' as const } }, { productName: { contains: keyword, mode: 'insensitive' as const } }] } : {}),
        ...(status ? { status } : {}),
        ...(createdAt ? { createdAt } : {}),
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
    if (errors.length) return NextResponse.json({ message: errors[0] }, { status: 400 });

    const workOrder = await prisma.workOrder.create({
      data: {
        code: String(data.code),
        productName: String(data.productName),
        stage: String(data.stage),
        priority: String(data.priority),
        status: String(data.status),
        progress: Number(data.progress),
        remark: data.remark === null ? null : String(data.remark || ''),
      },
      include: {
        resourceFiles: { where: { deletedAt: null, status: 'uploaded' }, select: { categoryId: true } },
      },
    });

    await logOp({ userId: user.id, action: 'create_work_order', targetType: 'work_order', targetId: workOrder.id, detail: { code: workOrder.code } });
    return NextResponse.json({ workOrder: serializeWorkOrder(workOrder) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    if ((e as { code?: string }).code === 'P2002') return NextResponse.json({ message: '工单号已存在' }, { status: 409 });
    console.error(e);
    return NextResponse.json({ message: '新建工单失败' }, { status: 500 });
  }
}
