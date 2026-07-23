import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { previewProductionPlanRelease, releaseProductionPlanBatch } from '@/lib/production-planning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as { batchIds?: unknown; target?: unknown; confirmWarnings?: unknown };
    const batchIds = Array.isArray(body.batchIds)
      ? body.batchIds.map(value => String(value)).filter(Boolean).slice(0, 100)
      : [];
    const target = body.target === 'preparation' || body.target === 'active' ? body.target : null;
    if (!batchIds.length || !target) return NextResponse.json({ ok: false, error: '请选择有效的下达批次和目标' }, { status: 400 });
    const releaseTime = new Date();
    const result = await prisma.$transaction(async tx => {
      const preview = await previewProductionPlanRelease(tx, { batchIds, target, now: releaseTime });
      if (preview.blockers > 0) throw new Error('PLAN_BATCH_BLOCKED');
      if (preview.warnings > 0 && body.confirmWarnings !== true) throw new Error('PLAN_BATCH_CONFIRMATION_REQUIRED');
      const released = [] as Array<{ batchId: string; workOrderId: string; warnings: string[] }>;
      for (const batchId of batchIds) {
        const item = await releaseProductionPlanBatch(tx, { batchId, target, actorId: user.id, now: releaseTime });
        released.push({ batchId, workOrderId: item.workOrderId, warnings: item.warnings });
      }
      return released;
    }, { timeout: 30_000 });
    return NextResponse.json({
      ok: true,
      result: {
        target,
        releasedCount: result.length,
        warningCount: result.reduce((sum, item) => sum + item.warnings.length, 0),
        items: result,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const message = error instanceof Error ? error.message : '';
    if (message === 'PLAN_BATCH_NOT_FOUND' || message === 'PLAN_BATCH_ARCHIVED') {
      return NextResponse.json({ ok: false, error: '排产批次不存在或已经归档' }, { status: 409 });
    }
    if (message === 'PLAN_ACTIVE_BATCH_CANNOT_MOVE_TO_PREPARATION') {
      return NextResponse.json({
        ok: false,
        error: '本周执行批次不能退回下周预备；未开工请走撤回流程，已开工必须继续闭环',
      }, { status: 409 });
    }
    if (message === 'PLAN_BATCH_SELECTION_INVALID') {
      return NextResponse.json({ ok: false, error: '部分排产批次不存在或已删除' }, { status: 404 });
    }
    if (message === 'PLAN_BATCH_BLOCKED') {
      return NextResponse.json({ ok: false, error: '存在不可下达的批次，请先处理阻断项后重试' }, { status: 409 });
    }
    if (message === 'PLAN_UNIT_WORK_TIME_REQUIRED') {
      return NextResponse.json({ ok: false, error: '未填写单件工时，不能下达周计划' }, { status: 409 });
    }
    if (message === 'PRODUCT_TIME_PROFILE_REQUIRED') {
      return NextResponse.json({ ok: false, error: '产品工序与工时尚未发布，不能下达周计划' }, { status: 409 });
    }
    if (message === 'PLAN_BATCH_CONFIRMATION_REQUIRED') {
      return NextResponse.json({ ok: false, requiresConfirmation: true, error: '存在资料、仓库或工艺提醒，请确认后继续' }, { status: 409 });
    }
    console.error('planning release commit failed', error);
    return NextResponse.json({ ok: false, error: '下达计划失败' }, { status: 500 });
  }
}
