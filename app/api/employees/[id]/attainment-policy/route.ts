import { NextRequest, NextResponse } from 'next/server';
import { requireCapability, ForbiddenError, UnauthorizedError, forbidden, unauthorized } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { AttainmentPolicyError } from '@/lib/employee-attainment-policy';
import { previewEmployeeAttainmentChange, previewTarget } from '@/lib/employee-attainment-policy-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireCapability('HR', 'UPDATE');
    const employee = await prisma.employee.findUnique({ where: { id: params.id } });
    if (!employee) return NextResponse.json({ ok: false, error: '员工档案不存在' }, { status: 404 });
    const body = await req.json() as Record<string, unknown>;
    const preview = await previewEmployeeAttainmentChange(employee, await previewTarget(employee, body), body);
    return NextResponse.json({ ok: true, preview });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden('只有人事部或管理员可以调整达成口径');
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : '口径预览失败',
      code: error instanceof AttainmentPolicyError ? error.code : undefined }, { status: error instanceof AttainmentPolicyError ? error.status : 400 });
  }
}
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireCapability('HR', 'READ');
    const changes = await prisma.employeeAttainmentPolicyChange.findMany({ where: { employeeId: params.id },
      orderBy: [{ effectiveDate: 'desc' }, { revision: 'desc' }], take: 50,
      select: { id: true, effectiveDate: true, revision: true, beforePolicy: true, afterPolicy: true, reason: true, createdAt: true } });
    return NextResponse.json({ ok: true, changes });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden();
    return NextResponse.json({ ok: false, error: '口径历史读取失败' }, { status: 500 });
  }
}
