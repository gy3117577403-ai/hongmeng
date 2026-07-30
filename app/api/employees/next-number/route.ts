import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  EMPLOYEE_NUMBER_SEQUENCE_KEY,
  formatEmployeeNumber,
} from '@/lib/employee-number';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    const sequence = await prisma.employeeNumberSequence.findUnique({
      where: { key: EMPLOYEE_NUMBER_SEQUENCE_KEY },
      select: { nextValue: true },
    });
    if (!sequence) {
      return NextResponse.json({ ok: false, error: '员工编号序列尚未初始化' }, { status: 503 });
    }
    return NextResponse.json({
      ok: true,
      nextEmployeeNo: formatEmployeeNumber(sequence.nextValue),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('employee number preview failed', error);
    return NextResponse.json({ ok: false, error: '员工编号预览失败' }, { status: 500 });
  }
}
