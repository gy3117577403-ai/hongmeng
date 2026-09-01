import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  sampleTaskInclude,
  serializeSampleDraftSection,
  serializeSampleTask,
} from '@/lib/sample-team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const task = await prisma.sampleTask.findFirst({
      where: { id: params.id, deletedAt: null },
      include: sampleTaskInclude,
    });
    if (!task) return NextResponse.json({ ok: false, error: '样品任务不存在' }, { status: 404 });
    return NextResponse.json({
      ok: true,
      task: serializeSampleTask(task),
      sections: task.draftSections.map(serializeSampleDraftSection),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('load sample draft sections failed', error);
    return NextResponse.json({ ok: false, error: '样品采集草稿加载失败' }, { status: 500 });
  }
}
