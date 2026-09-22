import { NextRequest, NextResponse } from 'next/server';
import { requireUser, UnauthorizedError, unauthorized, forbidden } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { warehouseMaterialTaskDetailInclude, serializeWarehouseMaterialTask } from '@/lib/warehouse-material';
import { mutateWarehouseException, reportSampleShortages } from '@/lib/material-exception-service';
import { MaterialInputError } from '@/lib/material-source';
export const dynamic = 'force-dynamic';
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const task = await prisma.warehouseMaterialTask.findFirst({ where: { sampleTaskId: params.id, sampleTask: { deletedAt: null } }, include: warehouseMaterialTaskDetailInclude });
    return NextResponse.json({ ok: true, task: task ? serializeWarehouseMaterialTask(task) : null });
  } catch (e) { if (e instanceof UnauthorizedError) return unauthorized(); throw e; }
}
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(), input = await req.json();
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MaterialInputError('提交内容不正确');
    const canConfirm = user.access.capabilities.includes('WAREHOUSE:UPDATE');
    if (!canConfirm && !user.access.capabilities.includes('PROCUREMENT:UPDATE')) return forbidden();
    const record = await prisma.warehouseMaterialTask.findUnique({ where: { sampleTaskId: params.id }, select: { id: true } });
    if (!record) throw new MaterialInputError('样品配料任务不存在', 404);
    const result = input.action === 'report_shortages'
      ? await reportSampleShortages(params.id, input, user.id, canConfirm)
      : await mutateWarehouseException(record.id, { ...input, action: input.confirm === true ? 'complete' : input.action }, user.id, canConfirm);
    return NextResponse.json({ ok: true, task: serializeWarehouseMaterialTask(result) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    if (e instanceof MaterialInputError) return NextResponse.json({ ok: false, error: e.message }, { status: e.statusCode });
    console.error('sample materials failed', e); return NextResponse.json({ ok: false, error: '配料保存失败，请刷新后重试' }, { status: 500 });
  }
}
