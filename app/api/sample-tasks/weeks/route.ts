import { NextRequest, NextResponse } from 'next/server';
import { requireUser, UnauthorizedError, unauthorized } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { sampleCurrentWeek, sampleTaskType, SamplePlanError } from '@/lib/sample-plan-domain';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const taskType = sampleTaskType(req.nextUrl.searchParams.get('taskType'));
    const groups = await prisma.sampleTask.groupBy({ by: ['planWeekStartDate', 'status'], where: { deletedAt: null, taskType, status: { not: 'CANCELLED' } }, _count: { _all: true }, orderBy: { planWeekStartDate: 'desc' } });
    const weeks = new Map<string, { week: string; total: number; unfinished: number }>();
    for (const group of groups) {
      const key = group.planWeekStartDate?.toISOString().slice(0, 10) || 'unplanned';
      const value = weeks.get(key) || { week: key, total: 0, unfinished: 0 };
      value.total += group._count._all; if (group.status !== 'COMPLETED') value.unfinished += group._count._all;
      weeks.set(key, value);
    }
    return NextResponse.json({ ok: true, currentWeek: sampleCurrentWeek(), weeks: [...weeks.values()] });
  } catch (e) { if (e instanceof UnauthorizedError) return unauthorized(); if (e instanceof SamplePlanError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 }); throw e; }
}
