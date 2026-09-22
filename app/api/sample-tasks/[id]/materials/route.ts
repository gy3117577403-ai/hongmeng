import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, UnauthorizedError, unauthorized } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { sampleMaterialLines, SamplePlanError } from '@/lib/sample-plan-domain';
import { warehouseMaterialTaskDetailInclude, serializeWarehouseMaterialTask } from '@/lib/warehouse-material';
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
    const rows = sampleMaterialLines(input.requirements);
    const canConfirm = user.access.capabilities.includes('WAREHOUSE:UPDATE');
    const result = await prisma.$transaction(async tx => {
      const record = await tx.warehouseMaterialTask.findUnique({ where: { sampleTaskId: params.id }, include: { sampleTask: true } });
      if (!record?.sampleTask || record.sampleTask.deletedAt) throw new SamplePlanError('样品配料任务不存在', 404);
      await tx.$queryRaw`SELECT id FROM warehouse_material_tasks WHERE id=${record.id} FOR UPDATE`;
      if (record.version !== Number(input.version)) throw new SamplePlanError('配料信息已更新，请刷新后重试', 409);
      if (['CANCELLED','COMPLETED'].includes(record.sampleTask.status)) throw new SamplePlanError('任务已结束，配料历史保留', 409);
      const before = sampleMaterialLines(record.requirements);
      if (!canConfirm && (input.confirm === true || rows.some(row => row.prepared !== (before.find(old => old.id === row.id)?.prepared || 0)) || before.some(row => row.prepared > 0 && !rows.some(next => next.id === row.id))))
        throw new SamplePlanError('已配数量和配料完成须由仓库人员确认', 403);
      const open = await tx.warehouseMaterialExceptionCase.count({ where: { warehouseTaskId: record.id, status: 'OPEN' } });
      const confirm = input.confirm === true;
      if (confirm && (open > 0 || rows.some(row => row.prepared < row.quantity))) throw new SamplePlanError('请先配齐物料并处理未解决异常', 409);
      if (confirm && !rows.length && input.noMaterials !== true) throw new SamplePlanError('没有物料清单，请明确确认无需另行配料');
      const status = open ? 'exception' : confirm ? 'completed' : 'pending';
      await tx.warehouseMaterialTask.update({ where: { id: record.id }, data: { requirements: rows as Prisma.InputJsonValue, requirementsConfirmed: confirm, status, completedAt: confirm ? new Date() : null, completedById: confirm ? user.id : null, updatedById: user.id, version: { increment: 1 } } });
      await tx.warehouseMaterialActivity.create({ data: { taskId: record.id, action: confirm ? 'sample_material_confirm' : 'sample_material_edit', actorId: user.id, fromStatus: record.status, toStatus: status, content: confirm ? rows.length ? '样品物料已配齐' : '已确认无需另行配料' : '更新样品配料清单', detail: { before, after: rows } as Prisma.InputJsonValue } });
      return tx.warehouseMaterialTask.findUniqueOrThrow({ where: { id: record.id }, include: warehouseMaterialTaskDetailInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true, task: serializeWarehouseMaterialTask(result) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    if (e instanceof SamplePlanError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') return NextResponse.json({ ok: false, error: '配料正在更新，请刷新后重试' }, { status: 409 });
    console.error('sample materials failed', e); return NextResponse.json({ ok: false, error: '配料保存失败' }, { status: 500 });
  }
}
