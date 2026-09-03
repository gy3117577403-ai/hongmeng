import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { chinaDate } from '@/lib/production-planning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    const records = await prisma.productionPlanImportBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true, requestId: true, status: true, sourceFileName: true, sourceSheetName: true,
        targetWeekStartDate: true, targetWeekEndDate: true, previewData: true, resultData: true,
        committedAt: true, createdAt: true, createdBy: { select: { username: true } },
      },
    });
    return NextResponse.json({
      ok: true,
      records: records.map(record => ({
        id: record.id,
        requestId: record.requestId,
        status: record.status,
        sourceFileName: record.sourceFileName,
        sourceSheetName: record.sourceSheetName,
        targetWeekStartDate: chinaDate(record.targetWeekStartDate),
        targetWeekEndDate: chinaDate(record.targetWeekEndDate),
        preview: record.previewData,
        result: record.resultData,
        operator: record.createdBy?.username || '系统用户',
        committedAt: record.committedAt?.toISOString() || null,
        createdAt: record.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('production plan import history failed', error);
    return NextResponse.json({ ok: false, error: '导入记录加载失败' }, { status: 500 });
  }
}
