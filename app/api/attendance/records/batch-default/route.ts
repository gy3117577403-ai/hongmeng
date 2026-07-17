import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  defaultAttendanceSegments,
  parseEmployeeIds,
  parseWorkDate,
  STANDARD_DAY_MILLISECONDS,
} from '@/lib/attendance';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const workDate = parseWorkDate(body.workDate);
    const requestedEmployeeIds = body.employeeIds === undefined ? [] : parseEmployeeIds(body.employeeIds);
    const employees = await prisma.employee.findMany({
      where: {
        isActive: true,
        attendanceEnabled: true,
        ...(requestedEmployeeIds.length ? { id: { in: requestedEmployeeIds } } : {}),
      },
      select: { id: true },
    });
    if (!employees.length) return NextResponse.json({ ok: false, error: '没有可生成考勤的在用员工' }, { status: 400 });
    const segments = defaultAttendanceSegments(workDate.key);
    const result = await prisma.attendanceRecord.createMany({
      data: employees.map(employee => ({
        employeeId: employee.id,
        workDate: workDate.value,
        status: 'draft',
        attendanceType: 'normal',
        plannedMilliseconds: STANDARD_DAY_MILLISECONDS,
        leaveMilliseconds: 0,
        actualMilliseconds: STANDARD_DAY_MILLISECONDS,
        overtimeMilliseconds: 0,
        segments: segments as unknown as Prisma.InputJsonValue,
        source: 'manual_default',
        createdById: user.id,
        updatedById: user.id,
      })),
      skipDuplicates: true,
    });
    await logOp({
      userId: user.id,
      action: 'batch_create_default_attendance',
      targetType: 'attendance_record',
      detail: { workDate: workDate.key, requested: employees.length, created: result.count },
    });
    return NextResponse.json({
      ok: true,
      requestedCount: employees.length,
      createdCount: result.count,
      skippedCount: employees.length - result.count,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const message = error instanceof Error ? error.message : '批量生成考勤失败';
    console.error('batch attendance failed', error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
