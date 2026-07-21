import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createWorkOrderProcessRoute } from '@/lib/process-routing';
import {
  alignProductionPlanBatchWeek,
  chinaDate,
  chinaWeekRange,
  effectivePlanningUnitMilliseconds,
  parsePlanDate,
  productionPlanTargetWeek,
} from '@/lib/production-planning';
import { productTimeTotalMilliseconds } from '@/lib/product-time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as { weekStartDate?: unknown; confirmWarnings?: unknown };
    const requested = parsePlanDate(body.weekStartDate);
    if (!requested) return NextResponse.json({ ok: false, error: '请选择要启用的预备周' }, { status: 400 });
    const range = chinaWeekRange(requested);
    const activationTime = new Date();
    const targetRange = productionPlanTargetWeek('active', activationTime);
    const batches = await prisma.productionPlanBatch.findMany({
      where: { deletedAt: null, releaseState: 'preparation', weekStartDate: range.start, workOrderId: { not: null } },
      include: {
        productTimeProfile: {
          select: { id: true, version: true, entries: { select: { unitMilliseconds: true } } },
        },
        planOrder: {
          select: {
            planningUnitMilliseconds: true,
            drawingLibraryItem: {
              select: {
                productTimeProfiles: {
                  where: { status: 'published' },
                  orderBy: { version: 'desc' },
                  take: 1,
                  select: { id: true, version: true, entries: { select: { unitMilliseconds: true } } },
                },
              },
            },
          },
        },
        workOrder: { select: { id: true, materialTask: { select: { status: true } }, processRoute: { select: { status: true } } } },
      },
    });
    if (!batches.length) return NextResponse.json({ ok: false, error: '所选周没有可启用的下周预备任务' }, { status: 409 });
    const profileByBatch = new Map(batches.map(batch => [
      batch.id,
      batch.productTimeProfile || batch.planOrder.drawingLibraryItem?.productTimeProfiles[0] || null,
    ]));
    const unitMillisecondsByBatch = new Map(batches.map(batch => {
      const profile = profileByBatch.get(batch.id);
      return [batch.id, effectivePlanningUnitMilliseconds(
        batch.unitMillisecondsSnapshot,
        profile ? productTimeTotalMilliseconds(profile.entries) : null,
        batch.planOrder.planningUnitMilliseconds,
      )] as const;
    }));
    const missingProfileBatches = batches.filter(batch => !profileByBatch.get(batch.id));
    if (missingProfileBatches.length) {
      return NextResponse.json({
        ok: false,
        error: `有 ${missingProfileBatches.length} 个批次尚未发布产品工序与工时，不能启用生产`,
        blockerCount: missingProfileBatches.length,
      }, { status: 409 });
    }
    const blockedBatches = batches.filter(batch => !unitMillisecondsByBatch.get(batch.id));
    if (blockedBatches.length) {
      return NextResponse.json({
        ok: false,
        error: `有 ${blockedBatches.length} 个批次未填写单根工时，不能启用生产`,
        blockerCount: blockedBatches.length,
      }, { status: 409 });
    }
    const warningCount = batches.reduce((sum, batch) => {
      const warehouseWarning = batch.workOrder?.materialTask?.status !== 'completed' ? 1 : 0;
      const processStatus = batch.workOrder?.processRoute?.status;
      const processWarning = !processStatus || processStatus === 'draft' ? 1 : 0;
      return sum + warehouseWarning + processWarning;
    }, 0);
    if (warningCount > 0 && body.confirmWarnings !== true) {
      return NextResponse.json({ ok: false, requiresConfirmation: true, error: '仓库或工艺准备尚未全部完成，请确认风险后再启用', warningCount }, { status: 409 });
    }
    const result = await prisma.$transaction(async tx => {
      const now = activationTime;
      const nextWorkOrderIds = batches.map(item => item.workOrderId).filter((id): id is string => Boolean(id));
      const current = await tx.productionPlanBatch.findMany({
        where: { deletedAt: null, releaseState: 'active', workOrderId: { not: null } },
        select: { id: true, workOrderId: true, planOrderId: true },
      });
      const currentWorkOrders = await tx.workOrder.findMany({
        where: {
          deletedAt: null,
          planActive: true,
          planType: { in: ['weekly_plan', 'managed_plan'] },
          id: { notIn: nextWorkOrderIds },
        },
        select: { id: true },
      });
      const currentWorkOrderIds = currentWorkOrders.map(item => item.id);
      for (const batch of batches) {
        const profile = profileByBatch.get(batch.id);
        if (!profile) throw new Error('PRODUCT_TIME_PROFILE_REQUIRED');
        const unitMilliseconds = unitMillisecondsByBatch.get(batch.id);
        if (!unitMilliseconds) throw new Error('PLAN_UNIT_WORK_TIME_REQUIRED');
        const totalMilliseconds = BigInt(unitMilliseconds) * BigInt(batch.quantity);
        const alignedWeek = alignProductionPlanBatchWeek(batch, 'active', now);
        await tx.productionPlanBatch.update({
          where: { id: batch.id },
          data: {
            weekStartDate: alignedWeek.weekStartDate,
            weekEndDate: alignedWeek.weekEndDate,
            plannedCompletionDate: alignedWeek.plannedCompletionDate,
            productTimeProfileId: profile.id,
            productTimeProfileVersion: profile.version,
            unitMillisecondsSnapshot: unitMilliseconds,
            totalMillisecondsSnapshot: totalMilliseconds,
          },
        });
        if (batch.workOrderId) {
          await tx.workOrder.update({
            where: { id: batch.workOrderId },
            data: {
              weekStartDate: alignedWeek.weekStartDate,
              weekEndDate: alignedWeek.weekEndDate,
              plannedAt: alignedWeek.plannedCompletionDate,
              unitWorkHours: (unitMilliseconds / 3_600_000).toFixed(4).replace(/0+$/, '').replace(/\.$/, ''),
              totalWorkHours: (Number(totalMilliseconds) / 3_600_000).toFixed(4).replace(/0+$/, '').replace(/\.$/, ''),
            },
          });
          await createWorkOrderProcessRoute(tx, { workOrderId: batch.workOrderId, actorId: user.id });
        }
      }
      if (currentWorkOrderIds.length) {
        await tx.workOrder.updateMany({
          where: { id: { in: currentWorkOrderIds } },
          data: { planActive: false, planClearedAt: now, planClearedBy: user.displayName || user.username },
        });
      }
      if (current.length) {
        await tx.productionPlanBatch.updateMany({ where: { id: { in: current.map(item => item.id) } }, data: { releaseState: 'archived' } });
      }
      await tx.workOrder.updateMany({
        where: { id: { in: nextWorkOrderIds } },
        data: { planActive: true, planClearedAt: null, planClearedBy: null },
      });
      await tx.productionPlanBatch.updateMany({
        where: { id: { in: batches.map(item => item.id) } },
        data: { releaseState: 'active', activatedAt: now, activatedById: user.id },
      });
      for (const batch of batches) {
        await tx.productionPlanChange.create({
          data: {
            planOrderId: batch.planOrderId,
            batchId: batch.id,
            action: 'activate_preparation_week',
            beforeData: {
              releaseState: 'preparation',
              weekStartDate: chinaDate(batch.weekStartDate),
              weekEndDate: chinaDate(batch.weekEndDate),
              plannedCompletionDate: chinaDate(batch.plannedCompletionDate),
            },
            afterData: {
              releaseState: 'active',
              planActive: true,
              weekStartDate: chinaDate(targetRange.start),
              weekEndDate: chinaDate(targetRange.end),
            },
            impactData: { warningCount },
            actorId: user.id,
          },
        });
      }
      await tx.operationLog.create({
        data: {
          userId: user.id,
          action: 'activate_production_plan_week',
          targetType: 'production_plan_week',
          targetId: targetRange.start.toISOString(),
          detail: {
            sourceWeekStartDate: chinaDate(range.start),
            targetWeekStartDate: chinaDate(targetRange.start),
            batchCount: batches.length,
            warningCount,
            archivedBatchCount: current.length,
            archivedWorkOrderCount: currentWorkOrderIds.length,
          },
        },
      });
      return {
        activated: batches.length,
        archived: current.length,
        archivedWorkOrders: currentWorkOrderIds.length,
        warningCount,
      };
    }, { timeout: 30_000 });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error && error.message === 'PLAN_UNIT_WORK_TIME_REQUIRED') {
      return NextResponse.json({ ok: false, error: '未填写单根工时，不能启用生产' }, { status: 409 });
    }
    if (error instanceof Error && error.message === 'PRODUCT_TIME_PROFILE_REQUIRED') {
      return NextResponse.json({ ok: false, error: '产品工序与工时尚未发布，不能启用生产' }, { status: 409 });
    }
    console.error('planning activation commit failed', error);
    return NextResponse.json({ ok: false, error: '启用本周计划失败' }, { status: 500 });
  }
}
