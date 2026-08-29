import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  automaticallyReleaseProductionPlanBatch,
  chinaDate,
  editableProductionPlanningWeek,
  moveProductionPlanBatchToWeek,
  planBatchSnapshot,
} from '@/lib/production-planning';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function batchIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))].slice(0, 200);
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const ids = batchIds(body.batchIds);
    if (!ids.length) {
      return NextResponse.json({ ok: false, error: '请选择需要调配的排产批次' }, { status: 400 });
    }
    const targetWeek = editableProductionPlanningWeek(body.targetWeekStartDate);
    if (!targetWeek) {
      return NextResponse.json({ ok: false, error: '只能调配到当前起未来 12 周内的生产周' }, { status: 400 });
    }
    const reason = String(body.reason || '周排单工作区调配').trim().slice(0, 300);
    const result = await prisma.$transaction(async tx => {
      const batches = await tx.productionPlanBatch.findMany({
        where: { id: { in: ids }, deletedAt: null, planOrder: { deletedAt: null } },
        orderBy: [{ weekStartDate: 'asc' }, { batchNo: 'asc' }],
      });
      if (batches.length !== ids.length) throw new Error('PLAN_MOVE_BATCH_MISSING');
      const targetStart = chinaDate(targetWeek.start);
      for (const batch of batches) {
        if (batch.releaseState !== 'draft') throw new Error('PLAN_MOVE_RELEASED_BATCH');
        if (chinaDate(batch.weekStartDate) === targetStart) throw new Error('PLAN_MOVE_SAME_WEEK');
      }
      for (const batch of batches) {
        const moved = moveProductionPlanBatchToWeek(batch, targetWeek.start);
        await tx.productionPlanBatch.update({
          where: { id: batch.id },
          data: moved,
        });
        await tx.productionPlanChange.create({
          data: {
            planOrderId: batch.planOrderId,
            batchId: batch.id,
            action: 'move_plan_batch_week',
            beforeData: planBatchSnapshot({
              quantity: batch.quantity,
              weekStartDate: batch.weekStartDate,
              weekEndDate: batch.weekEndDate,
              plannedCompletionDate: batch.plannedCompletionDate,
              unitMilliseconds: batch.unitMillisecondsSnapshot,
              batchNo: batch.batchNo,
              releaseState: batch.releaseState,
            }),
            afterData: planBatchSnapshot({
              quantity: batch.quantity,
              ...moved,
              unitMilliseconds: batch.unitMillisecondsSnapshot,
              batchNo: batch.batchNo,
              releaseState: batch.releaseState,
            }),
            reason,
            actorId: user.id,
          },
        });
      }
      let automaticallyActive = 0;
      let automaticallyPrepared = 0;
      for (const batch of batches) {
        const automaticRelease = await automaticallyReleaseProductionPlanBatch(tx, {
          batchId: batch.id,
          actorId: user.id,
          trigger: 'automatic_schedule',
        });
        if (automaticRelease?.target === 'active') automaticallyActive += 1;
        if (automaticRelease?.target === 'preparation') automaticallyPrepared += 1;
      }
      await tx.operationLog.create({
        data: {
          userId: user.id,
          action: 'move_production_plan_batches_week',
          targetType: 'production_plan_week',
          targetId: targetStart,
          detail: {
            batchIds: ids,
            batchCount: batches.length,
            targetWeekStartDate: targetStart,
            targetWeekEndDate: chinaDate(targetWeek.end),
            automaticallyActive,
            automaticallyPrepared,
          },
        },
      });
      return {
        movedCount: batches.length,
        targetWeekStartDate: targetStart,
        targetWeekEndDate: chinaDate(targetWeek.end),
        automaticallyActive,
        automaticallyPrepared,
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 180_000,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return NextResponse.json({ ok: false, error: '排产批次已被其他操作更新，请刷新后重试' }, { status: 409 });
    }
    if (error instanceof Error && error.message === 'PLAN_MOVE_BATCH_MISSING') {
      return NextResponse.json({ ok: false, error: '部分排产批次已不存在，请刷新后重试' }, { status: 409 });
    }
    if (error instanceof Error && error.message === 'PLAN_MOVE_RELEASED_BATCH') {
      return NextResponse.json({ ok: false, error: '已下达批次不能直接调配周次，请先走撤回或变更流程' }, { status: 409 });
    }
    if (error instanceof Error && error.message === 'PLAN_MOVE_SAME_WEEK') {
      return NextResponse.json({ ok: false, error: '所选批次已经位于目标生产周' }, { status: 409 });
    }
    console.error('commit planning week move failed', error);
    return NextResponse.json({ ok: false, error: '周次调配失败' }, { status: 500 });
  }
}
