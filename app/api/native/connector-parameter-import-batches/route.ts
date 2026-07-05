import { NextRequest } from 'next/server';
import { NativeUnauthorizedError, nativeError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireNativeUser(req);
    const limit = Math.max(1, Math.min(100, Number(req.nextUrl.searchParams.get('limit') || 50) || 50));
    const batches = await prisma.connectorParameterImportBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { _count: { select: { parameters: { where: { deletedAt: null } } } } },
    });
    return nativeOk({
      batches: batches.map(batch => ({
        id: batch.id,
        sourceType: batch.sourceType,
        fileName: batch.fileName,
        totalRows: batch.totalRows,
        readyCount: batch.readyCount,
        duplicateCount: batch.duplicateCount,
        invalidCount: batch.invalidCount,
        skippedCount: batch.skippedCount,
        insertedCount: batch.insertedCount,
        duplicateStrategy: batch.duplicateStrategy,
        createdBy: batch.createdBy,
        createdAt: batch.createdAt.toISOString(),
        rolledBackAt: batch.rolledBackAt?.toISOString() || null,
        rolledBackBy: batch.rolledBackBy,
        activeParameterCount: batch._count.parameters,
      })),
    });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('导入批次加载失败', 500);
  }
}
