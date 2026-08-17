import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { sampleTaskInclude, serializeSampleTask } from '@/lib/sample-team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { code: string } }) {
  try {
    await requireUser();
    const task = await prisma.sampleTask.findFirst({
      where: { qrCode: params.code, deletedAt: null },
      include: sampleTaskInclude,
    });
    if (!task) return NextResponse.json({ ok: false, error: '样品二维码无效或任务不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, task: serializeSampleTask(task) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('sample task qr lookup failed', error);
    return NextResponse.json({ ok: false, error: '样品任务读取失败' }, { status: 500 });
  }
}
