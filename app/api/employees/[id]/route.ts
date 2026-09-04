import { NextRequest, NextResponse } from 'next/server';
import {
  forbidden,
  ForbiddenError,
  requireCapability,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { cleanProcessText } from '@/lib/process-time';
import {
  attainmentEligibleFromConfiguration,
  parseAttainmentFactorBasisPoints,
  parseAttainmentStream,
} from '@/lib/attendance';
import { AttendanceGroupInputError, parseOptionalAttendanceGroup } from '@/lib/attendance-groups';
import { normalizeEmployeeMobile, EmployeeContactError } from '@/lib/employee-contact';
import {
  employeeHireDateToDate,
  EmployeeHireDateError,
  normalizeEmployeeHireDateInput,
} from '@/lib/employee-date';
import {
  departmentRecordSelect,
  EmployeeDepartmentInputError,
  employeeAccessAdminInclude,
  resolveEmployeeDepartmentInput,
  serializeEmployeeAccessAdmin,
} from '@/lib/employee-access-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireCapability('HR', 'UPDATE');
    const existing = await prisma.employee.findUnique({
      where: { id: params.id },
      include: employeeAccessAdminInclude,
    });
    if (!existing) return NextResponse.json({ ok: false, error: '员工档案不存在' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const employeeNo = body.employeeNo === undefined ? existing.employeeNo : cleanProcessText(body.employeeNo, 40);
    const name = body.name === undefined ? existing.name : cleanProcessText(body.name, 80);
    if (!employeeNo) return NextResponse.json({ ok: false, error: '员工编号不能为空' }, { status: 400 });
    if (employeeNo !== existing.employeeNo) {
      return NextResponse.json({
        ok: false,
        error: '员工编号由系统永久分配，不能在普通档案编辑中修改',
      }, { status: 409 });
    }
    if (!name) return NextResponse.json({ ok: false, error: '员工姓名不能为空' }, { status: 400 });
    if (body.isActive !== undefined && (body.isActive === true) !== existing.isActive) {
      return NextResponse.json({
        ok: false,
        error: existing.isActive ? '请使用“办理离职”完成状态变更' : '请使用“办理复职”恢复员工档案',
        code: 'EMPLOYMENT_ACTION_REQUIRED',
      }, { status: 409 });
    }
    const mobile = body.mobile === undefined ? existing.mobile : normalizeEmployeeMobile(body.mobile);
    if (mobile) {
      const duplicate = await prisma.employee.findFirst({
        where: { mobile, id: { not: existing.id } },
        select: { id: true },
      });
      if (duplicate) return NextResponse.json({ ok: false, error: '该手机号已绑定其他员工档案' }, { status: 409 });
    }
    const resolvedDepartment = await resolveEmployeeDepartmentInput(body, lookup =>
      prisma.department.findFirst({
        where: { isActive: true, ...lookup },
        select: departmentRecordSelect,
      }),
    );
    const requestedStream = body.attainmentEligible === false
      ? 'excluded'
      : body.attainmentEligible === true && body.attainmentStream === undefined
        ? 'batch'
        : parseAttainmentStream(body.attainmentStream, parseAttainmentStream(existing.attainmentStream));
    const requestedFactor = requestedStream === 'excluded'
      ? 0
      : parseAttainmentFactorBasisPoints(
          body.attainmentFactorBasisPoints,
          body.attainmentEligible === true && existing.attainmentFactorBasisPoints === 0
            ? 10_000
            : existing.attainmentFactorBasisPoints,
        );
    const attendanceGroup = body.attendanceGroup === undefined
      ? existing.attendanceGroup
      : parseOptionalAttendanceGroup(body.attendanceGroup) ?? 'UNASSIGNED';
    const employee = await prisma.employee.update({
      where: { id: existing.id },
      data: {
        name,
        ...(resolvedDepartment
          ? {
              departmentId: resolvedDepartment.departmentId,
              department: resolvedDepartment.department,
            }
          : {}),
        position: body.position === undefined ? existing.position : cleanProcessText(body.position, 80) || null,
        team: body.team === undefined ? existing.team : cleanProcessText(body.team, 80) || null,
        ...(body.hireDate === undefined
          ? {}
          : { hireDate: employeeHireDateToDate(normalizeEmployeeHireDateInput(body.hireDate) ?? null) }),
        mobile,
        notificationEnabled: existing.isActive && (body.notificationEnabled === undefined
          ? existing.notificationEnabled
          : body.notificationEnabled === true),
        attendanceEnabled: existing.isActive && (body.attendanceEnabled === undefined
          ? existing.attendanceEnabled
          : body.attendanceEnabled === true),
        attendanceGroup,
        attainmentEligible: attainmentEligibleFromConfiguration(requestedFactor, requestedStream),
        attainmentFactorBasisPoints: requestedFactor,
        attainmentStream: requestedStream,
      },
      include: employeeAccessAdminInclude,
    });
    const serializedEmployee = serializeEmployeeAccessAdmin(employee);
    await logOp({
      userId: user.id,
      action: 'update_employee',
      targetType: 'employee',
      targetId: employee.id,
      detail: {
        employeeNo: employee.employeeNo,
        previousDepartmentId: existing.departmentId,
        departmentId: employee.departmentId,
        permissionSyncPending: serializedEmployee.permissionSyncPending,
        attainmentFactorBasisPoints: employee.attainmentFactorBasisPoints,
        attainmentStream: employee.attainmentStream,
        previousAttendanceGroup: existing.attendanceGroup,
        attendanceGroup: employee.attendanceGroup,
      },
    });
    return NextResponse.json({ ok: true, employee: serializedEmployee });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden('只有人事部或管理员可以修改员工档案');
    if (error instanceof EmployeeDepartmentInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof EmployeeHireDateError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    if (error instanceof EmployeeContactError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof AttendanceGroupInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ ok: false, error: '员工编号、手机号或企业微信账号已被其他档案使用' }, { status: 409 });
    }
    console.error('update employee failed', error);
    return NextResponse.json({ ok: false, error: '保存员工档案失败' }, { status: 500 });
  }
}
