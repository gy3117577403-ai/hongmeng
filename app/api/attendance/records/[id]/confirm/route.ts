import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  attendanceEmployeeAllowed,
  resolveAttendanceAccessBoundary,
} from '@/lib/attendance-access';
import { serializeAttendanceRecord } from '@/lib/attendance';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const include = {
  employee: true,
  confirmedBy: { select: { id: true, username: true, displayName: true } },
} satisfies Prisma.AttendanceRecordInclude;

export async function POST(_: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const existing = await prisma.attendanceRecord.findUnique({
      where: { id: params.id },
      include: { employee: true },
    });
    if (!existing) return NextResponse.json({ ok: false, error: '考勤记录不存在' }, { status: 404 });
    const boundary = await resolveAttendanceAccessBoundary(user);
    if (!attendanceEmployeeAllowed(boundary, existing.employeeId)) {
      return NextResponse.json({ ok: false, error: '只能确认本人负责范围内的员工考勤' }, { status: 403 });
    }
    const record = await prisma.attendanceRecord.update({
      where: { id: existing.id },
      data: {
        status: 'confirmed',
        attainmentEligibleSnapshot: existing.attainmentEligibleSnapshot ?? existing.employee.attainmentEligible,
        attainmentFactorBasisPointsSnapshot: existing.attainmentFactorBasisPointsSnapshot
          ?? existing.employee.attainmentFactorBasisPoints,
        attainmentStreamSnapshot: existing.attainmentStreamSnapshot ?? existing.employee.attainmentStream,
        confirmedById: user.id,
        confirmedAt: new Date(),
        updatedById: user.id,
      },
      include,
    });
    await logOp({
      userId: user.id,
      action: 'confirm_attendance_record',
      targetType: 'attendance_record',
      targetId: record.id,
      detail: { employeeId: record.employeeId, workDate: record.workDate.toISOString().slice(0, 10) },
    });
    return NextResponse.json({ ok: true, record: serializeAttendanceRecord(record) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('confirm attendance record failed', error);
    return NextResponse.json({ ok: false, error: '确认考勤失败' }, { status: 500 });
  }
}
