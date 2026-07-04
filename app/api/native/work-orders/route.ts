import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { NativeUnauthorizedError, nativeError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';
import { serializeWorkOrder } from '@/lib/work-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireNativeUser(req);
    const keyword = req.nextUrl.searchParams.get('keyword')?.trim();
    const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') || 1) || 1);
    const pageSize = Math.max(10, Math.min(100, Number(req.nextUrl.searchParams.get('pageSize') || 30) || 30));
    const where: Prisma.WorkOrderWhereInput = {
      deletedAt: null,
      ...(keyword
        ? {
          OR: [
            { code: { contains: keyword, mode: 'insensitive' } },
            { customerName: { contains: keyword, mode: 'insensitive' } },
            { productName: { contains: keyword, mode: 'insensitive' } },
            { remark: { contains: keyword, mode: 'insensitive' } },
          ],
        }
        : {}),
    };
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
