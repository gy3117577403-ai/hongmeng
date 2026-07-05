import { NextRequest } from 'next/server';
import { NativeUnauthorizedError, nativeOk, nativeUnauthorized, nativeError, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';
import { serializeResourceFile } from '@/lib/resource-files';
import { serializeWorkOrder } from '@/lib/work-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireNativeUser(req);
    const keyword = String(req.nextUrl.searchParams.get('keyword') || '').trim();
    if (!keyword) return nativeOk({ workOrders: [], resourceFiles: [] });
    const [workOrders, resourceFiles] = await Promise.all([
      prisma.workOrder.findMany({
        where: {
          deletedAt: null,
          OR: [
            { code: { contains: keyword, mode: 'insensitive' } },
            { customerName: { contains: keyword, mode: 'insensitive' } },
            { productName: { contains: keyword, mode: 'insensitive' } },
            { remark: { contains: keyword, mode: 'insensitive' } },
          ],
        },
        include: { resourceFiles: { where: { deletedAt: null, status: 'uploaded' }, select: { categoryId: true } } },
        orderBy: [{ updatedAt: 'desc' }],
        take: 10,
      }),
      prisma.resourceFile.findMany({
        where: {
          deletedAt: null,
          status: 'uploaded',
          OR: [
            { originalName: { contains: keyword, mode: 'insensitive' } },
            { displayName: { contains: keyword, mode: 'insensitive' } },
            { remark: { contains: keyword, mode: 'insensitive' } },
            { version: { contains: keyword, mode: 'insensitive' } },
            { workOrder: { code: { contains: keyword, mode: 'insensitive' } } },
            { workOrder: { customerName: { contains: keyword, mode: 'insensitive' } } },
            { workOrder: { productName: { contains: keyword, mode: 'insensitive' } } },
            { category: { name: { contains: keyword, mode: 'insensitive' } } },
          ],
        },
        include: {
          workOrder: { select: { code: true, productName: true } },
          category: { select: { name: true, code: true } },
          uploadedBy: { select: { displayName: true, username: true } },
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: 10,
      }),
    ]);
    return nativeOk({ workOrders: workOrders.map(serializeWorkOrder), resourceFiles: resourceFiles.map(serializeResourceFile) });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('搜索失败', 500);
  }
}
