import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { reconcileProductionPlanDrawingLinks } from '@/lib/planning-product-link';
import { cleanProductTimeText, productTimeProfileInclude, serializeProductTimeProfile } from '@/lib/product-time';
import {
  chinaDate,
  chinaWeekRange,
  parsePlanDate,
  reconcileFutureActiveProductionPlanWeeks,
} from '@/lib/production-planning';
import type { ProductTimePlanningScope } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PlanningAggregate = {
  orderIds: Set<string>;
  batchCount: number;
  totalQuantity: number;
  releasedBatchCount: number;
  frozenBatchCount: number;
  snapshotTotalMilliseconds: bigint;
};

function planningScope(value: string): ProductTimePlanningScope {
  if (value === 'current' || value === 'next' || value === 'carryover' || value === 'history') return value;
  return 'all';
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await prisma.$transaction(async tx => {
      await reconcileFutureActiveProductionPlanWeeks(tx, { actorId: user.id });
      await reconcileProductionPlanDrawingLinks(tx);
    });
    const keyword = cleanProductTimeText(req.nextUrl.searchParams.get('keyword'), 100);
    const customer = cleanProductTimeText(req.nextUrl.searchParams.get('customer'), 120);
    const status = cleanProductTimeText(req.nextUrl.searchParams.get('status'), 20);
    const itemId = cleanProductTimeText(req.nextUrl.searchParams.get('itemId'), 80);
    const scope = planningScope(cleanProductTimeText(req.nextUrl.searchParams.get('scope'), 20));
    const naturalCurrent = chinaWeekRange(new Date());
    const nextInput = new Date(naturalCurrent.start);
    nextInput.setUTCDate(nextInput.getUTCDate() + 7);
    const naturalNext = chinaWeekRange(nextInput);
    const historyInput = parsePlanDate(req.nextUrl.searchParams.get('weekStartDate'));
    const defaultHistoryInput = new Date(naturalCurrent.start);
    defaultHistoryInput.setUTCDate(defaultHistoryInput.getUTCDate() - 7);
    const selectedRange = scope === 'current'
      ? naturalCurrent
      : scope === 'next'
        ? naturalNext
        : scope === 'history'
          ? chinaWeekRange(historyInput || defaultHistoryInput)
          : null;
    const candidateBatches = scope === 'all'
      ? []
      : await prisma.productionPlanBatch.findMany({
          where: {
            deletedAt: null,
            planOrder: { deletedAt: null, drawingLibraryItemId: { not: null } },
            ...(scope === 'carryover'
              ? { weekEndDate: { lt: naturalCurrent.start } }
              : selectedRange
                ? { weekStartDate: selectedRange.start }
                : {}),
          },
          select: {
            id: true,
            quantity: true,
            releaseState: true,
            productTimeProfileId: true,
            unitMillisecondsSnapshot: true,
            totalMillisecondsSnapshot: true,
            planOrder: { select: { id: true, drawingLibraryItemId: true } },
            workOrder: { select: { status: true, deletedAt: true } },
          },
          orderBy: [{ weekStartDate: 'asc' }, { batchNo: 'asc' }],
          take: 5000,
        });
    const planningBatches = scope === 'carryover'
      ? candidateBatches.filter(batch => {
          if (batch.workOrder) return !batch.workOrder.deletedAt && batch.workOrder.status !== 'completed';
          return batch.releaseState !== 'draft' && batch.releaseState !== 'archived';
        })
      : candidateBatches;
    const planningByItem = new Map<string, PlanningAggregate>();
    for (const batch of planningBatches) {
      const drawingLibraryItemId = batch.planOrder.drawingLibraryItemId;
      if (!drawingLibraryItemId) continue;
      const aggregate = planningByItem.get(drawingLibraryItemId) || {
        orderIds: new Set<string>(),
        batchCount: 0,
        totalQuantity: 0,
        releasedBatchCount: 0,
        frozenBatchCount: 0,
        snapshotTotalMilliseconds: BigInt(0),
      };
      aggregate.orderIds.add(batch.planOrder.id);
      aggregate.batchCount += 1;
      aggregate.totalQuantity += batch.quantity;
      if (batch.releaseState !== 'draft') aggregate.releasedBatchCount += 1;
      if (batch.productTimeProfileId || batch.unitMillisecondsSnapshot) aggregate.frozenBatchCount += 1;
      if (batch.totalMillisecondsSnapshot) aggregate.snapshotTotalMilliseconds += batch.totalMillisecondsSnapshot;
      planningByItem.set(drawingLibraryItemId, aggregate);
    }
    const plannedItemIds = [...planningByItem.keys()];
    const scopedItemIds = itemId ? plannedItemIds.filter(id => id === itemId) : plannedItemIds;
    const items = await prisma.drawingLibraryItem.findMany({
      where: {
        deletedAt: null,
        ...(scope !== 'all' ? { id: { in: scopedItemIds } } : itemId ? { id: itemId } : {}),
        ...(customer ? { customerName: customer } : {}),
        ...(keyword ? {
          OR: [
            { customerName: { contains: keyword, mode: 'insensitive' } },
            { customerCode: { contains: keyword, mode: 'insensitive' } },
            { specification: { contains: keyword, mode: 'insensitive' } },
            { productName: { contains: keyword, mode: 'insensitive' } },
          ],
        } : {}),
        ...(status === 'missing' ? { productTimeProfiles: { none: { status: { in: ['draft', 'published'] } } } } : {}),
        ...(status === 'unpublished' ? { productTimeProfiles: { none: { status: 'published' } } } : {}),
        ...(status === 'draft' ? { productTimeProfiles: { some: { status: 'draft' } } } : {}),
        ...(status === 'published' ? { productTimeProfiles: { some: { status: 'published' } } } : {}),
      },
      include: {
        productTimeProfiles: {
          where: { status: { in: ['draft', 'published'] } },
          orderBy: { version: 'desc' },
          include: productTimeProfileInclude,
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { customerName: 'asc' }, { specification: 'asc' }],
      take: 800,
    });
    const rows = items.map(item => {
      const draft = item.productTimeProfiles.find(profile => profile.status === 'draft') || null;
      const published = item.productTimeProfiles.find(profile => profile.status === 'published') || null;
      return {
        id: item.id,
        customerName: item.customerName,
        customerCode: item.customerCode,
        specification: item.specification,
        productName: item.productName,
        updatedAt: item.updatedAt.toISOString(),
        draft: draft ? serializeProductTimeProfile(draft) : null,
        published: published ? serializeProductTimeProfile(published) : null,
        planning: scope === 'all' ? null : (() => {
          const aggregate = planningByItem.get(item.id);
          if (!aggregate) return null;
          return {
            scope,
            weekStartDate: selectedRange ? chinaDate(selectedRange.start) : null,
            weekEndDate: selectedRange ? chinaDate(selectedRange.end) : null,
            orderCount: aggregate.orderIds.size,
            batchCount: aggregate.batchCount,
            totalQuantity: aggregate.totalQuantity,
            releasedBatchCount: aggregate.releasedBatchCount,
            frozenBatchCount: aggregate.frozenBatchCount,
            snapshotTotalMilliseconds: aggregate.snapshotTotalMilliseconds > BigInt(0)
              ? aggregate.snapshotTotalMilliseconds.toString()
              : null,
          };
        })(),
      };
    });
    const definitions = await prisma.processDefinition.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, stageGroup: true, sortOrder: true },
    });
    const customers = await prisma.drawingLibraryItem.groupBy({
      by: ['customerName'],
      where: { deletedAt: null },
      _count: { _all: true },
      orderBy: { customerName: 'asc' },
    });
    return NextResponse.json({
      ok: true,
      items: rows,
      definitions,
      customers: customers.map(item => ({ customerName: item.customerName, count: item._count._all })),
      summary: {
        total: rows.length,
        published: rows.filter(item => item.published).length,
        draft: rows.filter(item => item.draft).length,
        missing: rows.filter(item => !item.published && !item.draft).length,
      },
      planningScope: scope,
      planningSummary: scope === 'all' ? null : {
        productCount: rows.length,
        orderCount: new Set(planningBatches.map(batch => batch.planOrder.id)).size,
        batchCount: planningBatches.length,
        totalQuantity: planningBatches.reduce((sum, batch) => sum + batch.quantity, 0),
        publishedCount: rows.filter(item => item.published).length,
        missingCount: rows.filter(item => !item.published).length,
        weekStartDate: selectedRange ? chinaDate(selectedRange.start) : null,
        weekEndDate: selectedRange ? chinaDate(selectedRange.end) : null,
      },
      periods: {
        current: { weekStartDate: chinaDate(naturalCurrent.start), weekEndDate: chinaDate(naturalCurrent.end) },
        next: { weekStartDate: chinaDate(naturalNext.start), weekEndDate: chinaDate(naturalNext.end) },
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('product time profiles list failed', error);
    return NextResponse.json({ ok: false, error: '产品工时加载失败' }, { status: 500 });
  }
}
