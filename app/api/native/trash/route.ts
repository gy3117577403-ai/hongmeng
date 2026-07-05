import { NativeUnauthorizedError, nativeError, nativeFileDto, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { serializeConnectorParameter } from '@/lib/connector-parameters';
import { prisma } from '@/lib/prisma';
import { serializeWorkOrder } from '@/lib/work-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const user = await requireNativeUser(req);
    const [workOrders, resourceFiles, connectorParameters] = await Promise.all([
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
      prisma.connectorParameter.findMany({
        where: { deletedAt: { not: null } },
        orderBy: { deletedAt: 'desc' },
        take: 100,
      }),
    ]);
    return nativeOk({
      workOrders: workOrders.map(serializeWorkOrder),
      resourceFiles: resourceFiles.map(file => nativeFileDto(file, user.id)),
      connectorParameters: connectorParameters.map(serializeConnectorParameter),
    });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('回收站加载失败', 500);
  }
}
