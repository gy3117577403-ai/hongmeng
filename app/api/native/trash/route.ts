import { NativeUnauthorizedError, nativeError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';
import { serializeResourceFile } from '@/lib/resource-files';
import { serializeWorkOrder } from '@/lib/work-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    await requireNativeUser(req);
    const [workOrders, resourceFiles] = await Promise.all([
      prisma.workOrder.findMany({
        where: { deletedAt: { not: null } },
        include: { resourceFiles: { where: { deletedAt: null, status: 'uploaded' }, select: { categoryId: true } } },
        orderBy: { deletedAt: 'desc' },
      }),
      prisma.resourceFile.findMany({
        where: { OR: [{ deletedAt: { not: null } }, { status: 'deleted' }] },
        include: {
          workOrder: { select: { code: true, productName: true } },
          category: { select: { name: true, code: true } },
          uploadedBy: { select: { displayName: true, username: true } },
        },
        orderBy: { deletedAt: 'desc' },
      }),
    ]);
    return nativeOk({ workOrders: workOrders.map(serializeWorkOrder), resourceFiles: resourceFiles.map(serializeResourceFile) });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('回收站加载失败', 500);
  }
}
