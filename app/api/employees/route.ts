import { NextRequest, NextResponse } from 'next/server';
import {
  forbidden,
  ForbiddenError,
  requireCapability,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import { allocateEmployeeNumber } from '@/lib/employee-number';
import { normalizeEmployeeMobile, EmployeeContactError } from '@/lib/employee-contact';
import {
  employeeHireDateToDate,
  EmployeeHireDateError,
  normalizeEmployeeHireDateInput,
} from '@/lib/employee-date';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { cleanProcessText } from '@/lib/process-time';
import { chinaDateKey } from '@/lib/china-date';
import {
  attainmentEligibleFromConfiguration,
  parseAttainmentFactorBasisPoints,
  parseAttainmentStream,
} from '@/lib/attendance';
import {
  departmentRecordSelect,
  EmployeeDepartmentInputError,
  employeeAccessAdminInclude,
  resolveEmployeeDepartmentInput,
  serializeEmployeeAccessAdmin,
} from '@/lib/employee-access-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireCapability('HR', 'READ');
    const keyword = cleanProcessText(req.nextUrl.searchParams.get('keyword'), 80);
    const activeOnly = req.nextUrl.searchParams.get('active') === 'true';
    const employees = await prisma.employee.findMany({
      where: {
        ...(activeOnly ? { isActive: true } : {}),
        ...(keyword
          ? {
              OR: [
                { employeeNo: { contains: keyword, mode: 'insensitive' } },
                { name: { contains: keyword, mode: 'insensitive' } },
                { department: { contains: keyword, mode: 'insensitive' } },
                { position: { contains: keyword, mode: 'insensitive' } },
                { team: { contains: keyword, mode: 'insensitive' } },
                { mobile: { contains: keyword, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: employeeAccessAdminInclude,
      orderBy: [{ isActive: 'desc' }, { employeeNo: 'asc' }],
    });
    const now = new Date();
    return NextResponse.json({
      ok: true,
      employees: employees.map(employee => serializeEmployeeAccessAdmin(employee, now)),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden('只有人事部或管理员可以查看员工档案');
    console.error('employee list failed', error);
    return NextResponse.json({ ok: false, error: '员工档案加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireCapability('HR', 'CREATE');
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const name = cleanProcessText(body.name, 80);
    if (!name) return NextResponse.json({ ok: false, error: '请填写员工姓名' }, { status: 400 });
    const hireDate = normalizeEmployeeHireDateInput(body.hireDate) ?? null;
    const mobile = normalizeEmployeeMobile(body.mobile);
    const requestedStream = body.attainmentEligible === false
      ? 'excluded'
      : parseAttainmentStream(body.attainmentStream);
    const requestedFactor = requestedStream === 'excluded'
      ? 0
      : parseAttainmentFactorBasisPoints(body.attainmentFactorBasisPoints, 10_000);
    const employee = await prisma.$transaction(async tx => {
      const resolvedDepartment = await resolveEmployeeDepartmentInput(body, lookup =>
        tx.department.findFirst({
          where: { isActive: true, ...lookup },
          select: departmentRecordSelect,
        }),
      );
      if (mobile) {
        const duplicate = await tx.employee.findFirst({ where: { mobile }, select: { id: true } });
        if (duplicate) throw new EmployeeContactError('该手机号已绑定其他员工档案');
      }
      const employeeNo = await allocateEmployeeNumber(tx);
      const created = await tx.employee.create({
        data: {
          employeeNo,
          name,
          departmentId: resolvedDepartment?.departmentId ?? null,
          department: resolvedDepartment?.department ?? null,
          position: cleanProcessText(body.position, 80) || null,
          team: cleanProcessText(body.team, 80) || null,
          hireDate: employeeHireDateToDate(hireDate),
          mobile,
          notificationEnabled: body.notificationEnabled !== false,
          attendanceEnabled: body.attendanceEnabled !== false,
          attainmentEligible: attainmentEligibleFromConfiguration(requestedFactor, requestedStream),
          attainmentFactorBasisPoints: requestedFactor,
          attainmentStream: requestedStream,
        },
        include: employeeAccessAdminInclude,
      });
      await tx.employeeEmploymentEvent.create({
        data: {
          employeeId: created.id,
          eventType: 'HIRED',
          effectiveDate: employeeHireDateToDate(hireDate || chinaDateKey(new Date()))!,
          reason: '入职建档',
          actorId: user.id,
        },
      });
      return created;
    });
    await logOp({
      userId: user.id,
      action: 'create_employee',
      targetType: 'employee',
      targetId: employee.id,
      detail: { employeeNo: employee.employeeNo },
    });
    return NextResponse.json({
      ok: true,
      employee: serializeEmployeeAccessAdmin(employee),
    }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden('只有人事部或管理员可以新增员工档案');
    if (error instanceof EmployeeDepartmentInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof EmployeeHireDateError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    if (error instanceof EmployeeContactError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ ok: false, error: '员工编号、手机号或企业微信账号已被其他档案使用' }, { status: 409 });
    }
    console.error('create employee failed', error);
    return NextResponse.json({ ok: false, error: '新增员工失败' }, { status: 500 });
  }
}
