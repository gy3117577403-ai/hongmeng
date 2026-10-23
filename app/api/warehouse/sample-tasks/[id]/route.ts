import { NextRequest, NextResponse } from 'next/server';
import { requireUser, UnauthorizedError, unauthorized } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { sampleTaskInclude, serializeSampleTask } from '@/lib/sample-team';
export const dynamic = 'force-dynamic';
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const record = await prisma.warehouseMaterialTask.findFirst({ where: { sampleTaskId: params.id, status: { not: 'cancelled' }, sampleTask: { deletedAt: null, dataPurpose: 'PRODUCTION', status: { not: 'CANCELLED' } } }, include: { sampleTask: { include: sampleTaskInclude } } });
    if (!record?.sampleTask) return NextResponse.json({ ok: false, error: '样品配料任务不存在或已取消' }, { status: 404 });
    return NextResponse.json({ ok: true, task: serializeSampleTask(record.sampleTask) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized(error);
    console.error('warehouse sample detail failed', error);
    return NextResponse.json({ ok: false, error: '样品配料详情加载失败' }, { status: 500 });
  }
}
