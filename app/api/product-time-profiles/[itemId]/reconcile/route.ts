import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { syncDraftRoutesFromPublishedProductTime } from '@/lib/process-routing';
import { syncUnfinishedDailyTasksFromPublishedProductTime } from '@/lib/product-time-task-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { itemId: string } }) {
  try {
    const user = await requireUser();
    const result = await prisma.$transaction(async tx => {
      const profile = await tx.productTimeProfile.findFirst({
        where: { drawingLibraryItemId: params.itemId, status: 'published' },
        orderBy: [{ version: 'desc' }, { publishedAt: 'desc' }],
        select: { id: true, version: true, drawingLibraryItemId: true },
      });
      if (!profile) throw new Error('PUBLISHED_PROFILE_NOT_FOUND');
      const routeSync = await syncDraftRoutesFromPublishedProductTime(tx, {
        profileId: profile.id,
        actorId: user.id,
      });
      const dailyTaskSync = await syncUnfinishedDailyTasksFromPublishedProductTime(tx, {
        drawingLibraryItemId: profile.drawingLibraryItemId,
        profileId: profile.id,
        profileVersion: profile.version,
        actorId: user.id,
        reason: `主管手动校准产品工序与工时 V${profile.version}，同步在制路线、日任务及人员计划工时`,
      });
      await tx.operationLog.create({
        data: {
          userId: user.id,
          action: 'reconcile_published_product_time',
          targetType: 'product_time_profile',
          targetId: profile.id,
          detail: {
            drawingLibraryItemId: profile.drawingLibraryItemId,
            profileVersion: profile.version,
            routeSync,
            dailyTaskSync,
          },
        },
      });
      return { profile, routeSync, dailyTaskSync };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({
      ok: true,
      profileId: result.profile.id,
      profileVersion: result.profile.version,
      routeSync: result.routeSync,
      dailyTaskSynchronized: result.dailyTaskSync.synchronized,
      dailyTaskReviewRequired: result.dailyTaskSync.reviewRequired,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error && error.message === 'PUBLISHED_PROFILE_NOT_FOUND') {
      return NextResponse.json({ ok: false, error: '当前产品没有已发布的工序与工时版本' }, { status: 404 });
    }
    console.error('reconcile published product time failed', error);
    return NextResponse.json({ ok: false, error: '在制流程工时校准失败' }, { status: 500 });
  }
}
