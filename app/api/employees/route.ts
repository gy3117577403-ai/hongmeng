import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { cleanProcessText, serializeEmployee } from '@/lib/process-time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireUser();
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
              ],
            }
          : {}),
      },
      orderBy: [{ isActive: 'desc' }, { employeeNo: 'asc' }],
    });
    return NextResponse.json({ ok: true, employees: employees.map(serializeEmployee) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('employee list failed', error);
    return NextResponse.json({ ok: false, error: '员工档案加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const employeeNo = cleanProcessText(body.employeeNo, 40);
    const name = cleanProcessText(body.name, 80);
    if (!employeeNo) return NextResponse.json({ ok: false, error: '请填写员工编号' }, { status: 400 });
    if (!name) return NextResponse.json({ ok: false, error: '请填写员工姓名' }, { status: 400 });
    const employee = await prisma.employee.create({
      data: {
        employeeNo,
        name,
        department: cleanProcessText(body.department, 80) || null,
        position: cleanProcessText(body.position, 80) || null,
        team: cleanProcessText(body.team, 80) || null,
      },
    });
    await logOp({
      userId: user.id,
      action: 'create_employee',
      targetType: 'employee',
      targetId: employee.id,
      detail: { employeeNo: employee.employeeNo },
    });
    return NextResponse.json({ ok: true, employee: serializeEmployee(employee) }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ ok: false, error: '员工编号已经存在' }, { status: 409 });
    }
    console.error('create employee failed', error);
    return NextResponse.json({ ok: false, error: '新增员工失败' }, { status: 500 });
  }
}
