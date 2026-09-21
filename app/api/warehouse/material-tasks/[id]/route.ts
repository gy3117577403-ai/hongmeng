import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError, forbidden } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { warehouseMaterialTaskDetailInclude, serializeWarehouseMaterialTask } from '@/lib/warehouse-material';
import { mutateWarehouseException } from '@/lib/material-exception-service';
import { MaterialInputError } from '@/lib/material-source';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const task = await prisma.warehouseMaterialTask.findUnique({ where: { id: params.id }, include: warehouseMaterialTaskDetailInclude });
    if (!task) return NextResponse.json({ ok: false, error: '配料任务不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, task: serializeWarehouseMaterialTask(task) });
  } catch (error) { if (error instanceof UnauthorizedError) return unauthorized(); throw error; }
}
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const canConfirm = user.access.capabilities.includes('WAREHOUSE:UPDATE');
    if (!canConfirm && !user.access.capabilities.includes('PROCUREMENT:UPDATE')) return forbidden();
    const body = await req.json();
    const task = await mutateWarehouseException(params.id, body, user.id, canConfirm);
    return NextResponse.json({ ok: true, task: serializeWarehouseMaterialTask(task) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof MaterialInputError) return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    console.error('warehouse exception mutation failed', error);
    return NextResponse.json({ ok: false, error: '仓库异常保存失败，请刷新后重试' }, { status: 500 });
  }
}
