import { NextRequest, NextResponse } from 'next/server';
import { DailyProcessTaskStatus, Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { productTimeProfileInclude, serializeProductTimeProfile } from '@/lib/product-time';
import { syncDraftRoutesFromPublishedProductTime } from '@/lib/process-routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { itemId: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const expectedRevision = Number(body.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      return NextResponse.json({ ok: false, error: '请先保存当前产品工时草稿' }, { status: 400 });
    }
    const result = await prisma.$transaction(async tx => {
      const draft = await tx.productTimeProfile.findFirst({
        where: { drawingLibraryItemId: params.itemId, status: 'draft' },
        include: { entries: { select: { id: true } } },
      });
      if (!draft) throw new Error('DRAFT_NOT_FOUND');
      if (draft.revision !== expectedRevision) throw new Error('PRODUCT_TIME_CONFLICT');
      if (!draft.entries.length) throw new Error('PRODUCT_TIME_EMPTY');
      await tx.productTimeProfile.updateMany({
        where: { drawingLibraryItemId: params.itemId, status: 'published' },
        data: { status: 'archived', updatedById: user.id },
      });
      const updated = await tx.productTimeProfile.updateMany({
        where: { id: draft.id, revision: draft.revision, status: 'draft' },
        data: {
          status: 'published',
          revision: { increment: 1 },
          publishedAt: new Date(),
          publishedById: user.id,
          updatedById: user.id,
        },
      });
      if (updated.count !== 1) throw new Error('PRODUCT_TIME_CONFLICT');
      await tx.operationLog.create({
        data: {
          userId: user.id,
          action: 'publish_product_time_profile',
          targetType: 'product_time_profile',
          targetId: draft.id,
          detail: { drawingLibraryItemId: params.itemId, version: draft.version, processCount: draft.entries.length },
        },
      });
      const routeSync = await syncDraftRoutesFromPublishedProductTime(tx, {
        profileId: draft.id,
        actorId: user.id,
      });
      const unfinishedDailyTasks = await tx.dailyProcessTask.findMany({
        where: {
          workOrder: { drawingLibraryItemId: params.itemId },
          status: {
            notIn: [
              DailyProcessTaskStatus.COMPLETED,
              DailyProcessTaskStatus.CARRIED_OVER,
              DailyProcessTaskStatus.CANCELLED,
              DailyProcessTaskStatus.NEEDS_REVIEW,
            ],
          },
          OR: [
            { productTimeProfileId: { not: draft.id } },
            { productTimeProfileVersion: { not: draft.version } },
            { productTimeProfileId: null },
            { productTimeProfileVersion: null },
          ],
        },
        select: {
          id: true,
          planId: true,
          status: true,
          version: true,
          productTimeProfileId: true,
          productTimeProfileVersion: true,
          routeVersion: true,
        },
      });
      let dailyTaskReviewRequired = 0;
      for (const task of unfinishedDailyTasks) {
        const updatedTask = await tx.dailyProcessTask.updateMany({
          where: {
            id: task.id,
            version: task.version,
            status: {
              notIn: [
                DailyProcessTaskStatus.COMPLETED,
                DailyProcessTaskStatus.CARRIED_OVER,
                DailyProcessTaskStatus.CANCELLED,
                DailyProcessTaskStatus.NEEDS_REVIEW,
              ],
            },
          },
          data: { status: DailyProcessTaskStatus.NEEDS_REVIEW, version: { increment: 1 } },
        });
        if (updatedTask.count !== 1) continue;
        dailyTaskReviewRequired += 1;
        await tx.dailyPlanRevision.create({
          data: {
            planId: task.planId,
            taskId: task.id,
            action: 'PRODUCT_TIME_REPUBLISHED_REVIEW_REQUIRED',
            beforeData: {
              status: task.status,
              productTimeProfileId: task.productTimeProfileId,
              productTimeProfileVersion: task.productTimeProfileVersion,
              routeVersion: task.routeVersion,
            },
            afterData: {
              status: DailyProcessTaskStatus.NEEDS_REVIEW,
              publishedProductTimeProfileId: draft.id,
              publishedProductTimeProfileVersion: draft.version,
            },
            reason: '产品工序与工时版本已重新发布，请复核未完成日任务',
            actorId: user.id,
          },
        });
      }
      return { profileId: draft.id, routeSync, dailyTaskReviewRequired };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const profile = await prisma.productTimeProfile.findUnique({
      where: { id: result.profileId },
      include: productTimeProfileInclude,
    });
    return NextResponse.json({
      ok: true,
      profile: profile ? serializeProductTimeProfile(profile) : null,
      routeSync: result.routeSync,
      dailyTaskReviewRequired: result.dailyTaskReviewRequired,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error) {
      if (error.message === 'DRAFT_NOT_FOUND') return NextResponse.json({ ok: false, error: '没有可发布的产品工时草稿' }, { status: 404 });
      if (error.message === 'PRODUCT_TIME_EMPTY') return NextResponse.json({ ok: false, error: '至少配置一道工序后才能发布' }, { status: 400 });
      if (error.message === 'PRODUCT_TIME_CONFLICT') return NextResponse.json({ ok: false, error: '产品工时已被其他人修改，请刷新后重试' }, { status: 409 });
    }
    console.error('publish product time profile failed', error);
    return NextResponse.json({ ok: false, error: '产品工时发布失败' }, { status: 500 });
  }
}
