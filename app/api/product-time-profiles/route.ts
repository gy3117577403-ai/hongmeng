import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  productQuotationTimeInclude,
  serializeProductQuotationTime,
} from '@/lib/product-quotation';
import { cleanProductTimeText, productTimeProfileInclude, serializeProductTimeProfile } from '@/lib/product-time';
import {
  chinaDate,
  chinaWeekRange,
  parsePlanDate,
} from '@/lib/production-planning';
import type { ProductTimePlanningScope } from '@/types';
import {
  beginRequestObservation,
  markRequest,
  observedJson,
  observeResponse,
} from '@/lib/request-observability';

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

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(req: NextRequest) {
  const observation = beginRequestObservation();
  try {
    await requireUser();
    markRequest(observation, 'auth');
    const keyword = cleanProductTimeText(req.nextUrl.searchParams.get('keyword'), 100);
    const customer = cleanProductTimeText(req.nextUrl.searchParams.get('customer'), 120);
    const status = cleanProductTimeText(req.nextUrl.searchParams.get('status'), 20);
    const itemId = cleanProductTimeText(req.nextUrl.searchParams.get('itemId'), 80);
    const scope = planningScope(cleanProductTimeText(req.nextUrl.searchParams.get('scope'), 20));
    const page = positiveInt(req.nextUrl.searchParams.get('page'), 1);
    const pageSize = Math.min(100, positiveInt(req.nextUrl.searchParams.get('pageSize'), 50));
    const includeOptions = page === 1 && req.nextUrl.searchParams.get('includeOptions') !== '0';
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
    markRequest(observation, 'planning_scope');
    const plannedItemIds = [...planningByItem.keys()];
    const scopedItemIds = itemId ? plannedItemIds.filter(id => id === itemId) : plannedItemIds;
    const itemWhere: Prisma.DrawingLibraryItemWhereInput = {
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
        ...(status === 'quotation_missing' ? { quotationTimes: { none: { status: 'active' } } } : {}),
    };
    const [total, items, definitions, customers] = await Promise.all([
      prisma.drawingLibraryItem.count({ where: itemWhere }),
      prisma.drawingLibraryItem.findMany({
      where: itemWhere,
      include: {
        productTimeProfiles: {
          where: { status: { in: ['draft', 'published'] } },
          orderBy: { version: 'desc' },
          include: productTimeProfileInclude,
        },
        quotationTimes: {
          where: { status: 'active' },
          orderBy: { version: 'desc' },
          take: 1,
          include: productQuotationTimeInclude,
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { customerName: 'asc' }, { specification: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      }),
      includeOptions ? prisma.processDefinition.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, code: true, name: true, stageGroup: true, sortOrder: true },
      }) : Promise.resolve(null),
      includeOptions ? prisma.drawingLibraryItem.groupBy({
        by: ['customerName'],
        where: { deletedAt: null },
        _count: { _all: true },
        orderBy: { customerName: 'asc' },
      }) : Promise.resolve(null),
    ]);
    markRequest(observation, 'product_page');
    const planningReferences = items.length
      ? await prisma.productionPlanOrder.findMany({
          where: {
            deletedAt: null,
            drawingLibraryItemId: { in: items.map(item => item.id) },
            planningUnitMilliseconds: { gt: 0 },
          },
          select: {
            id: true,
            drawingLibraryItemId: true,
            planningUnitMilliseconds: true,
            updatedAt: true,
            batches: {
              where: { deletedAt: null },
              orderBy: [{ updatedAt: 'desc' }, { batchNo: 'desc' }],
              take: 1,
              select: {
                id: true,
                batchNo: true,
                quantity: true,
                weekStartDate: true,
                weekEndDate: true,
                updatedAt: true,
              },
            },
          },
          orderBy: { updatedAt: 'desc' },
          take: 5000,
        })
      : [];
    const planningReferenceByItem = new Map<string, {
      planOrderId: string;
      batchId: string | null;
      batchNo: number | null;
      quantity: number;
      unitMilliseconds: number;
      weekStartDate: string | null;
      weekEndDate: string | null;
      updatedAt: string;
    }>();
    for (const order of planningReferences) {
      if (!order.drawingLibraryItemId || !order.planningUnitMilliseconds || planningReferenceByItem.has(order.drawingLibraryItemId)) continue;
      const batch = order.batches[0] || null;
      planningReferenceByItem.set(order.drawingLibraryItemId, {
        planOrderId: order.id,
        batchId: batch?.id || null,
        batchNo: batch?.batchNo ?? null,
        quantity: batch?.quantity || 0,
        unitMilliseconds: order.planningUnitMilliseconds,
        weekStartDate: batch ? chinaDate(batch.weekStartDate) : null,
        weekEndDate: batch ? chinaDate(batch.weekEndDate) : null,
        updatedAt: (batch?.updatedAt || order.updatedAt).toISOString(),
      });
    }
    markRequest(observation, 'planning_reference');
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
        quotation: item.quotationTimes[0] ? serializeProductQuotationTime(item.quotationTimes[0]) : null,
        planningReference: planningReferenceByItem.get(item.id) || null,
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
    return observedJson(observation, {
      ok: true,
      requestId: observation.requestId,
      items: rows,
      ...(definitions ? { definitions } : {}),
      ...(customers ? { customers: customers.map(item => ({ customerName: item.customerName, count: item._count._all })) } : {}),
      summary: {
        total,
        published: rows.filter(item => item.published).length,
        draft: rows.filter(item => item.draft).length,
        missing: rows.filter(item => !item.published && !item.draft).length,
        quotationMissing: rows.filter(item => !item.quotation).length,
      },
      planningScope: scope,
      planningSummary: scope === 'all' ? null : {
        productCount: total,
        orderCount: new Set(planningBatches.map(batch => batch.planOrder.id)).size,
        batchCount: planningBatches.length,
        totalQuantity: planningBatches.reduce((sum, batch) => sum + batch.quantity, 0),
        publishedCount: rows.filter(item => item.published).length,
        missingCount: rows.filter(item => !item.published).length,
        quotationMissingCount: rows.filter(item => !item.quotation).length,
        weekStartDate: selectedRange ? chinaDate(selectedRange.start) : null,
        weekEndDate: selectedRange ? chinaDate(selectedRange.end) : null,
      },
      periods: {
        current: { weekStartDate: chinaDate(naturalCurrent.start), weekEndDate: chinaDate(naturalCurrent.end) },
        next: { weekStartDate: chinaDate(naturalNext.start), weekEndDate: chinaDate(naturalNext.end) },
      },
      pagination: {
        page,
        pageSize,
        total,
        hasMore: page * pageSize < total,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return observeResponse(observation, unauthorized());
    console.error('product time profiles list failed', {
      requestId: observation.requestId,
      code: 'PRODUCT_TIME_LIST_FAILED',
      durationMs: Number((performance.now() - observation.startedAt).toFixed(1)),
      error,
    });
    return observedJson(observation, {
      ok: false,
      code: 'PRODUCT_TIME_LIST_FAILED',
      requestId: observation.requestId,
      error: '产品工时加载失败，请稍后重试',
    }, { status: 500 });
  }
}
