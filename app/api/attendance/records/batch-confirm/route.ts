import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { parseWorkDate } from '@/lib/attendance';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  attendanceRecordScopeWhere,
  parseAttendanceWorkforceScope,
  type AttendanceWorkforceScope,
} from '@/lib/production-workforce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const workDate = parseWorkDate(body.workDate);
    const scope: AttendanceWorkforceScope = body.scope
      ? parseAttendanceWorkforceScope(body.scope)
      : 'ALL';
    const now = new Date();
    const result = await prisma.attendanceRecord.updateMany({
      where: {
        workDate: workDate.value,
        status: 'draft',
        employee: { isActive: true, attendanceEnabled: true },
        ...attendanceRecordScopeWhere(scope),
      },
      data: {
        status: 'confirmed',
        confirmedById: user.id,
        confirmedAt: now,
        updatedById: user.id,
      },
    });
    await logOp({
      userId: user.id,
      action: 'batch_confirm_attendance',
      targetType: 'attendance_record',
      detail: { workDate: workDate.key, scope, confirmedCount: result.count },
    });
    return NextResponse.json({ ok: true, confirmedCount: result.count });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const message = error instanceof Error ? error.message : '批量确认考勤失败';
    console.error('batch confirm attendance failed', error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
