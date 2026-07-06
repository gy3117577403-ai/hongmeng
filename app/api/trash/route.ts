import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { serializeResourceFile } from '@/lib/resource-files';
import { prisma } from '@/lib/prisma';
import { serializeWorkOrder } from '@/lib/work-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    const [workOrders, resourceFiles] = await Promise.all([
      prisma.workOrder.findMany({
        where: { deletedAt: { not: null } },
        include: { resourceFiles: { where: { deletedAt: null, status: 'uploaded' }, select: { categoryId: true } } },
        orderBy: { deletedAt: 'desc' },
      }),
      prisma.resourceFile.findMany({
        where: { OR: [{ deletedAt: { not: null } }, { status: 'deleted' }] },
        include: {
          workOrder: { select: { code: true, specification: true, productName: true } },
          category: { select: { name: true, code: true } },
          uploadedBy: { select: { displayName: true, username: true } },
        },
        orderBy: { deletedAt: 'desc' },
      }),
    ]);
    return NextResponse.json({
      ok: true,
      workOrders: workOrders.map(serializeWorkOrder),
      resourceFiles: resourceFiles.map(serializeResourceFile),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    return NextResponse.json({ ok: false, error: '回收站加载失败' }, { status: 500 });
  }
}
