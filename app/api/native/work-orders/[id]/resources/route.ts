import { NextRequest } from 'next/server';
import { NativeUnauthorizedError, nativeError, nativeFileDto, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requiredCategoryCodes = new Set(['drawing', 'sop', 'product']);

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireNativeUser(req);
    const workOrder = await prisma.workOrder.findFirst({ where: { id: params.id, deletedAt: null }, select: { id: true } });
    if (!workOrder) return nativeError('工单不存在', 404);
    const [categories, files] = await Promise.all([
      prisma.resourceCategory.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.resourceFile.findMany({
        where: { workOrderId: params.id, deletedAt: null, status: 'uploaded' },
        include: {
          uploadedBy: { select: { displayName: true, username: true } },
          category: { select: { name: true, code: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { version: 'desc' }],
      }),
    ]);
    const fileCounts = files.reduce<Record<string, number>>((acc, file) => {
      acc[file.categoryId] = (acc[file.categoryId] || 0) + 1;
      return acc;
    }, {});
    return nativeOk({
      categories: categories.map(category => ({
        id: category.id,
        code: category.code,
        name: category.name,
        required: requiredCategoryCodes.has(category.code),
        sortOrder: category.sortOrder,
        fileCount: fileCounts[category.id] || 0,
      })),
      files: files.map(nativeFileDto),
    });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('资料加载失败', 500);
  }
}
