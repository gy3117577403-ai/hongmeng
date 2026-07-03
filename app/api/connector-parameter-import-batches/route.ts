import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const limit = Math.max(1, Math.min(100, Number(req.nextUrl.searchParams.get('limit') || 50) || 50));
    const batches = await prisma.connectorParameterImportBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        _count: {
          select: {
            parameters: { where: { deletedAt: null } },
          },
        },
      },
    });

    return NextResponse.json({
      ok: true,
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
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '导入批次加载失败' }, { status: 500 });
  }
}
