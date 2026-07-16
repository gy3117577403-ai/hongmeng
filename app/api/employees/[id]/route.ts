import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { cleanProcessText, serializeEmployee } from '@/lib/process-time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const existing = await prisma.employee.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ ok: false, error: '员工档案不存在' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const employeeNo = body.employeeNo === undefined ? existing.employeeNo : cleanProcessText(body.employeeNo, 40);
    const name = body.name === undefined ? existing.name : cleanProcessText(body.name, 80);
    if (!employeeNo) return NextResponse.json({ ok: false, error: '员工编号不能为空' }, { status: 400 });
    if (!name) return NextResponse.json({ ok: false, error: '员工姓名不能为空' }, { status: 400 });
    const employee = await prisma.employee.update({
      where: { id: existing.id },
      data: {
        employeeNo,
        name,
        department: body.department === undefined ? existing.department : cleanProcessText(body.department, 80) || null,
        team: body.team === undefined ? existing.team : cleanProcessText(body.team, 80) || null,
        isActive: body.isActive === undefined ? existing.isActive : body.isActive === true,
      },
    });
    await logOp({
      userId: user.id,
      action: employee.isActive ? 'update_employee' : 'disable_employee',
      targetType: 'employee',
      targetId: employee.id,
      detail: { employeeNo: employee.employeeNo },
    });
    return NextResponse.json({ ok: true, employee: serializeEmployee(employee) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ ok: false, error: '员工编号已经存在' }, { status: 409 });
    }
    console.error('update employee failed', error);
    return NextResponse.json({ ok: false, error: '保存员工档案失败' }, { status: 500 });
  }
}
