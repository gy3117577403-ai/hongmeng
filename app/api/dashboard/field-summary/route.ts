import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { serializeResourceFile } from '@/lib/resource-files';
import { prisma } from '@/lib/prisma';
import { serializeWorkOrder } from '@/lib/work-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requiredCategoryCodes = new Set(['drawing', 'sop', 'product']);

export async function GET() {
  try {
    await requireUser();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const categories = await prisma.resourceCategory.findMany({ orderBy: { sortOrder: 'asc' } });
    const requiredIds = categories.filter(c => requiredCategoryCodes.has(c.code)).map(c => c.id);
    const workOrders = await prisma.workOrder.findMany({
      where: { deletedAt: null, planActive: true },
      include: { resourceFiles: { where: { deletedAt: null, status: 'uploaded' }, select: { categoryId: true } } },
      orderBy: [{ updatedAt: 'desc' }],
    });

    const missing = [];
    const complete = [];
    for (const order of workOrders) {
      const fileCategoryIds = new Set(order.resourceFiles.map(f => f.categoryId));
      const total = order.resourceFiles.length;
      if (total > 0 && requiredIds.every(id => fileCategoryIds.has(id))) complete.push(order);
      else missing.push(order);
    }

    const recentFiles = await prisma.resourceFile.findMany({
      where: { deletedAt: null, status: 'uploaded' },
      include: {
        workOrder: { select: { code: true, specification: true, productName: true } },
        category: { select: { name: true, code: true } },
        uploadedBy: { select: { displayName: true, username: true } },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 5,
    });

    const todayWorkOrders = workOrders.filter(o => o.createdAt >= today);
    return NextResponse.json({
      ok: true,
      counts: {
        missingWorkOrders: missing.length,
        completeWorkOrders: complete.length,
        recentFiles: recentFiles.length,
        todayWorkOrders: todayWorkOrders.length,
      },
      missingWorkOrders: missing.slice(0, 5).map(serializeWorkOrder),
      completeWorkOrders: complete.slice(0, 5).map(serializeWorkOrder),
      recentFiles: recentFiles.map(serializeResourceFile),
      todayWorkOrders: todayWorkOrders.slice(0, 5).map(serializeWorkOrder),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    return NextResponse.json({ ok: false, error: '现场概览加载失败' }, { status: 500 });
  }
}
