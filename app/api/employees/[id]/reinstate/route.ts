import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { chinaDateKey } from '@/lib/china-date';
import {
  EmployeeOffboardingError,
  parseEmployeeEffectiveDate,
} from '@/lib/employee-offboarding';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { serializeEmployee } from '@/lib/process-time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const effectiveDate = parseEmployeeEffectiveDate(body.effectiveDate || chinaDateKey(new Date()));
    const existing = await prisma.employee.findUnique({
      where: { id: params.id },
      include: { user: { select: { id: true } } },
    });
    if (!existing) {
      throw new EmployeeOffboardingError('员工档案不存在', { status: 404, code: 'EMPLOYEE_NOT_FOUND' });
    }
    if (existing.isActive) {
      throw new EmployeeOffboardingError('该员工当前已在职', { status: 409, code: 'ALREADY_ACTIVE' });
    }
    if (existing.resignedAt && effectiveDate.value < existing.resignedAt) {
      throw new EmployeeOffboardingError('复职日期不能早于最近一次离职日期');
    }
    if (existing.mobile) {
      const duplicate = await prisma.employee.findFirst({
        where: { id: { not: existing.id }, mobile: existing.mobile, isActive: true },
        select: { id: true },
      });
      if (duplicate) {
        throw new EmployeeOffboardingError('该手机号已被其他在职员工使用，请先核对联系方式', {
          status: 409,
          code: 'MOBILE_IN_USE',
        });
      }
    }

    const restoreLogin = body.restoreLogin === true;
    const employee = await prisma.$transaction(async tx => {
      const updated = await tx.employee.update({
        where: { id: params.id },
        data: {
          isActive: true,
          attendanceEnabled: body.attendanceEnabled !== false,
          notificationEnabled: body.notificationEnabled !== false,
          resignedAt: null,
          resignationReason: null,
          resignationNote: null,
        },
      });
      if (restoreLogin && existing.user) {
        await tx.user.update({ where: { id: existing.user.id }, data: { isActive: true } });
      }
      await tx.employeeEmploymentEvent.create({
        data: {
          employeeId: params.id,
          eventType: 'REINSTATED',
          effectiveDate: effectiveDate.value,
          reason: '复职',
          note: String(body.note || '').trim().slice(0, 500) || null,
          actorId: user.id,
        },
      });
      return updated;
    });

    await logOp({
      userId: user.id,
      action: 'reinstate_employee',
      targetType: 'employee',
      targetId: employee.id,
      detail: {
        employeeNo: employee.employeeNo,
        effectiveDate: effectiveDate.key,
        loginRestored: restoreLogin && Boolean(existing.user),
      },
    });
    return NextResponse.json({ ok: true, employee: serializeEmployee(employee) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof EmployeeOffboardingError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('employee reinstatement failed', error);
    return NextResponse.json({ ok: false, error: '办理复职失败' }, { status: 500 });
  }
}
