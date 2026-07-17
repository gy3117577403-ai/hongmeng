import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { serializeAbnormalTimeEvent } from '@/lib/attendance';
import { cleanProcessText } from '@/lib/process-time';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const include = {
  allocations: { include: { employee: true }, orderBy: { employee: { employeeNo: 'asc' as const } } },
  qualityConfirmedBy: { select: { id: true, username: true, displayName: true } },
  resolvedBy: { select: { id: true, username: true, displayName: true } },
  workOrder: { select: { id: true, code: true, customerName: true, specification: true, productName: true } },
  processStep: { select: { id: true, processCode: true, processName: true } },
} satisfies Prisma.AbnormalTimeEventInclude;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const resolutionNote = cleanProcessText(body.resolutionNote, 1000);
    if (!resolutionNote) return NextResponse.json({ ok: false, error: '请填写异常处理结果' }, { status: 400 });
    const existing = await prisma.abnormalTimeEvent.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!existing) return NextResponse.json({ ok: false, error: '异常工时记录不存在' }, { status: 404 });
    const event = await prisma.abnormalTimeEvent.update({
      where: { id: existing.id },
      data: {
        resolutionStatus: 'resolved',
        resolutionNote,
        resolvedById: user.id,
        resolvedAt: new Date(),
        updatedById: user.id,
      },
      include,
    });
    await logOp({
      userId: user.id,
      action: 'resolve_abnormal_time_event',
      targetType: 'abnormal_time_event',
      targetId: event.id,
      detail: { sequence: event.sequence },
    });
    return NextResponse.json({ ok: true, event: serializeAbnormalTimeEvent(event) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('resolve abnormal time failed', error);
    return NextResponse.json({ ok: false, error: '关闭异常工时失败' }, { status: 500 });
  }
}
