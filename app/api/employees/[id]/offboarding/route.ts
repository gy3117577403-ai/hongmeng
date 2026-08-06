import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { chinaDateKey } from '@/lib/china-date';
import {
  EmployeeOffboardingError,
  parseEmployeeEffectiveDate,
  parseOffboardingInput,
} from '@/lib/employee-offboarding';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { serializeEmployee } from '@/lib/process-time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function loadPreview(employeeId: string, effectiveDate: Date) {
  const [
    employee,
    activeAssignments,
    plannedAssignments,
    activeMemberships,
    pendingCrossTeamRequests,
    weeklyPresets,
    futureCapacityOverrides,
    futureAttendanceRecords,
    openIssues,
  ] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        user: { select: { id: true, username: true, isActive: true } },
        employmentEvents: {
          orderBy: { createdAt: 'desc' },
          take: 8,
          include: { actor: { select: { displayName: true } } },
        },
      },
    }),
    prisma.dailyTaskAssignment.count({ where: { employeeId, status: 'ACTIVE' } }),
    prisma.dailyTaskAssignment.count({ where: { employeeId, status: 'PLANNED' } }),
    prisma.productionPlanningMembership.count({ where: { employeeId, isActive: true } }),
    prisma.dailyCrossTeamRequest.count({ where: { employeeId, status: 'PENDING' } }),
    prisma.weeklyProcessWorkerPresetMember.count({ where: { employeeId } }),
    prisma.dailyCapacityOverride.count({
      where: { employeeId, plan: { workDate: { gte: effectiveDate } } },
    }),
    prisma.attendanceRecord.count({ where: { employeeId, workDate: { gte: effectiveDate } } }),
    prisma.issue.count({
      where: {
        deletedAt: null,
        status: { not: 'closed' },
        OR: [
          { assigneeEmployeeId: employeeId },
          { collaborators: { some: { employeeId } } },
        ],
      },
    }),
  ]);

  if (!employee) throw new EmployeeOffboardingError('员工档案不存在', { status: 404, code: 'EMPLOYEE_NOT_FOUND' });

  return {
    employee,
    impact: {
      activeAssignments,
      plannedAssignments,
      activeMemberships,
      pendingCrossTeamRequests,
      weeklyPresets,
      futureCapacityOverrides,
      futureAttendanceRecords,
      openIssues,
      linkedLogin: Boolean(employee.user),
      linkedLoginActive: employee.user?.isActive === true,
    },
    blocked: activeAssignments > 0,
    blockerMessage: activeAssignments > 0
      ? `仍有 ${activeAssignments} 项正在执行的派工，请先在日计划中完成或转派`
      : null,
    history: employee.employmentEvents.map(event => ({
      id: event.id,
      eventType: event.eventType,
      effectiveDate: event.effectiveDate.toISOString().slice(0, 10),
      reason: event.reason,
      note: event.note,
      actorName: event.actor?.displayName || '系统',
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const date = parseEmployeeEffectiveDate(
      req.nextUrl.searchParams.get('effectiveDate') || chinaDateKey(new Date()),
    );
    const preview = await loadPreview(params.id, date.value);
    return NextResponse.json({ ok: true, ...preview });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof EmployeeOffboardingError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('employee offboarding preview failed', error);
    return NextResponse.json({ ok: false, error: '离职影响检查失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const input = parseOffboardingInput(body);
    const preview = await loadPreview(params.id, input.effectiveDate);
    if (!preview.employee.isActive) {
      throw new EmployeeOffboardingError('该员工已办理离职，无需重复操作', { status: 409, code: 'ALREADY_RESIGNED' });
    }
    if (preview.employee.hireDate && input.effectiveDate < preview.employee.hireDate) {
      throw new EmployeeOffboardingError('离职日期不能早于入职日期');
    }
    if (preview.blocked) {
      throw new EmployeeOffboardingError(preview.blockerMessage || '员工仍有正在执行的派工', {
        status: 409,
        code: 'ACTIVE_ASSIGNMENTS_EXIST',
      });
    }

    const now = new Date();
    const employee = await prisma.$transaction(async tx => {
      const activeAssignments = await tx.dailyTaskAssignment.count({
        where: { employeeId: params.id, status: 'ACTIVE' },
      });
      if (activeAssignments > 0) {
        throw new EmployeeOffboardingError(`仍有 ${activeAssignments} 项正在执行的派工，请先完成或转派`, {
          status: 409,
          code: 'ACTIVE_ASSIGNMENTS_EXIST',
        });
      }
      await tx.dailyTaskAssignment.updateMany({
        where: { employeeId: params.id, status: 'PLANNED' },
        data: { status: 'CANCELLED', cancelledAt: now },
      });
      await tx.dailyCrossTeamRequest.updateMany({
        where: { employeeId: params.id, status: 'PENDING' },
        data: {
          status: 'CANCELLED',
          reviewedAt: now,
          reviewedById: user.id,
          reviewNote: '员工离职，系统自动取消待处理跨组申请',
        },
      });
      await tx.productionPlanningMembership.updateMany({
        where: { employeeId: params.id, isActive: true },
        data: { isActive: false, effectiveTo: input.effectiveDate },
      });
      await tx.dailyCapacityOverride.deleteMany({
        where: {
          employeeId: params.id,
          plan: { workDate: { gte: input.effectiveDate } },
        },
      });
      await tx.user.updateMany({
        where: { employeeId: params.id },
        data: { isActive: false },
      });
      const statusChange = await tx.employee.updateMany({
        where: { id: params.id, isActive: true },
        data: {
          isActive: false,
          attendanceEnabled: false,
          notificationEnabled: false,
          resignedAt: input.effectiveDate,
          resignationReason: input.reason,
          resignationNote: input.note,
        },
      });
      if (statusChange.count !== 1) {
        throw new EmployeeOffboardingError('该员工已办理离职，无需重复操作', {
          status: 409,
          code: 'ALREADY_RESIGNED',
        });
      }
      const updated = await tx.employee.findUniqueOrThrow({ where: { id: params.id } });
      await tx.employeeEmploymentEvent.create({
        data: {
          employeeId: params.id,
          eventType: 'RESIGNED',
          effectiveDate: input.effectiveDate,
          reason: input.reason,
          note: input.note,
          actorId: user.id,
        },
      });
      return updated;
    });

    await logOp({
      userId: user.id,
      action: 'offboard_employee',
      targetType: 'employee',
      targetId: employee.id,
      detail: {
        employeeNo: employee.employeeNo,
        effectiveDate: input.effectiveDateKey,
        reason: input.reason,
        cancelledPlannedAssignments: preview.impact.plannedAssignments,
        cancelledCrossTeamRequests: preview.impact.pendingCrossTeamRequests,
        disabledPlanningMemberships: preview.impact.activeMemberships,
        removedFutureCapacityOverrides: preview.impact.futureCapacityOverrides,
        loginDisabled: preview.impact.linkedLoginActive,
      },
    });
    return NextResponse.json({ ok: true, employee: serializeEmployee(employee), impact: preview.impact });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof EmployeeOffboardingError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('employee offboarding failed', error);
    return NextResponse.json({ ok: false, error: '办理离职失败' }, { status: 500 });
  }
}
