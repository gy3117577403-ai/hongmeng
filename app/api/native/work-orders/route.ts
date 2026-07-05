import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { logOp } from '@/lib/logs';
import { NativeUnauthorizedError, nativeError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';
import { parseWorkOrderBody, serializeWorkOrder } from '@/lib/work-orders';
import { snapshotChange, workOrderSnapshot } from '@/lib/change-snapshots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireNativeUser(req);
    const keyword = req.nextUrl.searchParams.get('keyword')?.trim();
    const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') || 1) || 1);
    const pageSize = Math.max(10, Math.min(100, Number(req.nextUrl.searchParams.get('pageSize') || 30) || 30));
    const where: Prisma.WorkOrderWhereInput = { deletedAt: null };
    if (keyword) {
      where.OR = [
        { code: { contains: keyword, mode: 'insensitive' } },
        { customerName: { contains: keyword, mode: 'insensitive' } },
        { productName: { contains: keyword, mode: 'insensitive' } },
        { remark: { contains: keyword, mode: 'insensitive' } },
      ];
    }
    const [total, workOrders] = await Promise.all([
      prisma.workOrder.count({ where }),
      prisma.workOrder.findMany({
        where,
        include: { resourceFiles: { where: { deletedAt: null, status: 'uploaded' }, select: { categoryId: true } } },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return nativeOk({ workOrders: workOrders.map(serializeWorkOrder), page, pageSize, total });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('工单加载失败', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireNativeUser(req);
    const body = await req.json().catch(() => ({}));
    const { data, errors } = parseWorkOrderBody(body);
    if (errors.length) return nativeError(errors[0], 400);

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
      include: { resourceFiles: { where: { deletedAt: null, status: 'uploaded' }, select: { categoryId: true } } },
    });

    await logOp({ userId: user.id, action: 'create_work_order', targetType: 'work_order', targetId: workOrder.id, detail: { code: workOrder.code, client: 'harmony_native' } });
    await snapshotChange({
      entityType: 'work_order',
      entityId: workOrder.id,
      action: 'create_work_order',
      after: workOrderSnapshot(workOrder),
      changedBy: user.displayName || user.username,
    });
    return nativeOk({ workOrder: serializeWorkOrder(workOrder) });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    if ((e as { code?: string }).code === 'P2002') return nativeError('工单号已存在', 409);
    console.error(e);
    return nativeError('新建工单失败', 500);
  }
}
