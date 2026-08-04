import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const employeeNo = String(req.nextUrl.searchParams.get('employeeNo') || '').trim().slice(0, 40);
  if (!/^\d{2,12}$/.test(employeeNo)) {
    return NextResponse.json({ ok: true, found: false });
  }
  const employee = await prisma.employee.findUnique({
    where: { employeeNo },
    select: {
      employeeNo: true,
      name: true,
      department: true,
      position: true,
      team: true,
      isActive: true,
      user: { select: { isActive: true } },
    },
  });
  if (!employee || !employee.isActive || !employee.user?.isActive) {
    return NextResponse.json({ ok: true, found: false });
  }
  return NextResponse.json({
    ok: true,
    found: true,
    employee: {
      employeeNo: employee.employeeNo,
      name: employee.name,
      department: employee.department,
      position: employee.position,
      team: employee.team,
    },
  });
}
