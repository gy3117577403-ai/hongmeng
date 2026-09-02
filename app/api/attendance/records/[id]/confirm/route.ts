import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  attendanceEmployeeAllowed,
  departedAttendanceCorrectionError,
  resolveAttendanceAccessBoundary,
} from '@/lib/attendance-access';
import { serializeAttendanceRecord } from '@/lib/attendance';
import { requireAttendanceWorkday } from '@/lib/attendance-calendar-service';
import { hasCapability } from '@/lib/department-access';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { cleanProcessText } from '@/lib/process-time';
import { isEmployeeEmployedOnDate } from '@/lib/production-workforce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const include = {
  employee: true,
  confirmedBy: { select: { id: true, username: true, displayName: true } },
} satisfies Prisma.AttendanceRecordInclude;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const existing = await prisma.attendanceRecord.findUnique({
      where: { id: params.id },
      include: { employee: true },
    });
    if (!existing) return NextResponse.json({ ok: false, error: '考勤记录不存在' }, { status: 404 });
    const workDateKey = existing.workDate.toISOString().slice(0, 10);
    await requireAttendanceWorkday(workDateKey);
    if (!isEmployeeEmployedOnDate(existing.employee, workDateKey)) {
      return NextResponse.json({ ok: false, error: '不能确认在职区间外的考勤记录' }, { status: 409 });
    }
    const historicalCorrection = !existing.employee.isActive;
    const correctionReason = cleanProcessText(body.correctionReason, 500);
    if (historicalCorrection) {
      const correctionError = departedAttendanceCorrectionError({
        hasHrUpdate: hasCapability(user.access, 'HR', 'UPDATE'),
        existingRecord: true,
        correctionReason,
      });
      if (correctionError) {
        return NextResponse.json({ ok: false, error: correctionError.error }, { status: correctionError.status });
      }
    } else {
      const boundary = await resolveAttendanceAccessBoundary(user);
      if (!attendanceEmployeeAllowed(boundary, existing.employeeId)) {
        return NextResponse.json({ ok: false, error: '只能确认本人负责范围内的员工考勤' }, { status: 403 });
      }
      if (!existing.employee.attendanceEnabled) {
        return NextResponse.json({ ok: false, error: '该员工未启用考勤' }, { status: 409 });
      }
    }
    const updateData = {
      status: 'confirmed',
      attainmentEligibleSnapshot: existing.attainmentEligibleSnapshot ?? existing.employee.attainmentEligible,
      attainmentFactorBasisPointsSnapshot: existing.attainmentFactorBasisPointsSnapshot
        ?? existing.employee.attainmentFactorBasisPoints,
      attainmentStreamSnapshot: existing.attainmentStreamSnapshot ?? existing.employee.attainmentStream,
      confirmedById: user.id,
      confirmedAt: new Date(),
      updatedById: user.id,
    } satisfies Prisma.AttendanceRecordUncheckedUpdateInput;
    const record = historicalCorrection
      ? await prisma.$transaction(async tx => {
        const corrected = await tx.attendanceRecord.update({
          where: { id: existing.id },
          data: updateData,
          include,
        });
        await tx.operationLog.create({
          data: {
            userId: user.id,
            action: 'correct_departed_employee_attendance',
            targetType: 'attendance_record',
            targetId: corrected.id,
            detail: {
              employeeId: corrected.employeeId,
              workDate: workDateKey,
              correctionReason,
              before: {
                status: existing.status,
                confirmedById: existing.confirmedById,
                confirmedAt: existing.confirmedAt?.toISOString() || null,
                updatedAt: existing.updatedAt.toISOString(),
              },
              after: {
                status: corrected.status,
                confirmedById: corrected.confirmedById,
                confirmedAt: corrected.confirmedAt?.toISOString() || null,
                updatedAt: corrected.updatedAt.toISOString(),
              },
            },
          },
        });
        return corrected;
      })
      : await prisma.attendanceRecord.update({ where: { id: existing.id }, data: updateData, include });
    if (!historicalCorrection) {
      await logOp({
        userId: user.id,
        action: 'confirm_attendance_record',
        targetType: 'attendance_record',
        targetId: record.id,
        detail: { employeeId: record.employeeId, workDate: workDateKey },
      });
    }
    return NextResponse.json({ ok: true, record: serializeAttendanceRecord(record) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('confirm attendance record failed', error);
    return NextResponse.json({ ok: false, error: '确认考勤失败' }, { status: 500 });
  }
}
