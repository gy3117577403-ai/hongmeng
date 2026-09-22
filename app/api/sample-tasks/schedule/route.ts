import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, UnauthorizedError, unauthorized } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { sampleWeek, SamplePlanError } from '@/lib/sample-plan-domain';
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser(), input = await req.json();
    const week = sampleWeek(input.week), reason = String(input.reason || '').trim().slice(0,500);
    if (!reason) throw new SamplePlanError('请填写排期调整原因');
    if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100 || input.items.some((i: any) => !i || typeof i.id !== 'string' || !Number.isInteger(i.version)) || new Set(input.items.map((i: any) => i.id)).size !== input.items.length) throw new SamplePlanError('请选择 1 至 100 条不同的计划');
    await prisma.$transaction(async tx => {
      for (const row of [...input.items].sort((a,b) => a.id.localeCompare(b.id))) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-task:${row.id}`}))`;
        const task = await tx.sampleTask.findFirst({ where: { id: row.id, deletedAt: null } });
        if (!task || task.version !== row.version || ['COMPLETED','CANCELLED'].includes(task.status)) throw new SamplePlanError('所选计划已更新或已结束，请刷新后重新选择',409);
        const previous = task.planWeekStartDate?.toISOString().slice(0,10) || null;
        if (previous === week) continue;
        const entry = { at: new Date().toISOString(), actor: user.displayName || user.username, reason, fromWeek: previous, toWeek: week, fromDue: task.dueDate?.toISOString().slice(0,10) || null, toDue: task.dueDate?.toISOString().slice(0,10) || null, fromWarning: task.warningDays, toWarning: task.warningDays };
        await tx.sampleTask.update({ where: { id: task.id }, data: { planWeekStartDate: week ? new Date(week) : null, scheduleHistory: [...(Array.isArray(task.scheduleHistory) ? task.scheduleHistory : []),entry] as Prisma.InputJsonValue, updatedById: user.id, updatedByName: user.displayName || user.username, version: { increment: 1 } } });
        await tx.operationLog.create({ data: { userId: user.id, action: 'sample_batch_schedule', targetType: 'sample_task', targetId: task.id, detail: entry } });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    if (e instanceof SamplePlanError) return NextResponse.json({ ok:false,error:e.message },{status:e.status});
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') return NextResponse.json({ok:false,error:'计划正在更新，请刷新后重试'},{status:409});
    console.error('sample schedule failed',e); return NextResponse.json({ok:false,error:'排期保存失败'},{status:500});
  }
}
