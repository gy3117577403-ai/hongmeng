import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { productTimeTotalMilliseconds } from '@/lib/product-time';
import { reconcileProductionPlanDrawingLinks } from '@/lib/planning-product-link';
import { normalizePlanningSopDrawingStatus, normalizePlanningSopStage } from '@/lib/planning-sop';
import {
  chinaDate,
  chinaWeekRange,
  parseProductionPlanOrderInput,
  planOrderSnapshot,
  productionPlanOrderInclude,
  reconcileAutomaticallyReleasedProductionPlanBatches,
  reconcileLegacyDeletedPlanQuantities,
  reconcileFutureActiveProductionPlanWeeks,
  resolveOrCreatePlanningProduct,
  serializeProductionPlanOrder,
} from '@/lib/production-planning';
import type {
  ProductionPlanProductOptionDTO,
  ProductionPlanningSummaryDTO,
  ProductionPlanningWeekDTO,
} from '@/types';
import { resolveProductionEntityScope } from '@/lib/production-access-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function keywordWhere(keyword: string): Prisma.ProductionPlanOrderWhereInput {
  return {
    OR: [
      { sourceOrderNo: { contains: keyword, mode: 'insensitive' } },
      { customerName: { contains: keyword, mode: 'insensitive' } },
      { salesperson: { contains: keyword, mode: 'insensitive' } },
      { productName: { contains: keyword, mode: 'insensitive' } },
      { specification: { contains: keyword, mode: 'insensitive' } },
      { remark: { contains: keyword, mode: 'insensitive' } },
    ],
  };
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const productionScope = resolveProductionEntityScope(user);
    if (productionScope.canReconcile) {
      await prisma.$transaction(async tx => {
        await reconcileLegacyDeletedPlanQuantities(tx, { actorId: user.id });
        await reconcileFutureActiveProductionPlanWeeks(tx, { actorId: user.id });
        await reconcileAutomaticallyReleasedProductionPlanBatches(tx, { actorId: user.id });
        await reconcileProductionPlanDrawingLinks(tx);
      }, { maxWait: 10_000, timeout: 180_000 });
    }
    const keyword = String(req.nextUrl.searchParams.get('keyword') || '').trim().slice(0, 160);
    const status = String(req.nextUrl.searchParams.get('status') || '').trim();
    const customer = String(req.nextUrl.searchParams.get('customer') || '').trim().slice(0, 120);
    const where: Prisma.ProductionPlanOrderWhereInput = {
      deletedAt: null,
      ...(keyword ? keywordWhere(keyword) : {}),
      ...(status && status !== 'all' ? { status } : {}),
      ...(customer ? { customerName: customer } : {}),
    };
    const records = await prisma.productionPlanOrder.findMany({
      where,
      include: productionPlanOrderInclude,
      orderBy: [{ priority: 'asc' }, { customerDueDate: 'asc' }, { createdAt: 'desc' }],
      take: 5000,
    });
    const allRecords = keyword || (status && status !== 'all') || customer
      ? await prisma.productionPlanOrder.findMany({
          where: { deletedAt: null },
          include: productionPlanOrderInclude,
          orderBy: { customerDueDate: 'asc' },
          take: 5000,
        })
      : records;
    const all = allRecords.map(serializeProductionPlanOrder);
    const batches = all.flatMap(order => order.batches);
    const naturalCurrentWeek = chinaWeekRange(new Date());
    const currentStart = chinaDate(naturalCurrentWeek.start);
    const currentEnd = chinaDate(naturalCurrentWeek.end);
    const nextWeekStart = addDays(naturalCurrentWeek.start, 7);
    const nextWeek = chinaWeekRange(nextWeekStart);
    const nextStart = chinaDate(nextWeek.start);
    const nextEnd = chinaDate(nextWeek.end);
    const afterNextWeek = chinaWeekRange(addDays(naturalCurrentWeek.start, 14));
    const afterNextStart = chinaDate(afterNextWeek.start);
    const afterNextEnd = chinaDate(afterNextWeek.end);
    const weekSummary = (weekStartDate: string, weekEndDate: string): ProductionPlanningWeekDTO => {
      const weekBatches = batches.filter(batch => batch.weekStartDate === weekStartDate);
      return {
        weekStartDate,
        weekEndDate,
        batchCount: weekBatches.length,
        totalQuantity: weekBatches.reduce((sum, batch) => sum + batch.quantity, 0),
        unfinishedCount: weekBatches.filter(batch => (
          batch.releaseState !== 'archived' && !batch.workOrderCompletedAt
        )).length,
      };
    };
    const historyMap = new Map<string, ProductionPlanningWeekDTO>();
    for (const batch of batches) {
      if (batch.weekStartDate >= currentStart) continue;
      const current = historyMap.get(batch.weekStartDate);
      if (current) {
        current.batchCount += 1;
        current.totalQuantity += batch.quantity;
        if (batch.releaseState !== 'archived' && !batch.workOrderCompletedAt) {
          current.unfinishedCount = (current.unfinishedCount || 0) + 1;
        }
        continue;
      }
      historyMap.set(batch.weekStartDate, {
        weekStartDate: batch.weekStartDate,
        weekEndDate: batch.weekEndDate,
        batchCount: 1,
        totalQuantity: batch.quantity,
        unfinishedCount: batch.releaseState !== 'archived' && !batch.workOrderCompletedAt ? 1 : 0,
      });
    }
    const history = [...historyMap.values()]
      .sort((left, right) => right.weekStartDate.localeCompare(left.weekStartDate));
    const summary: ProductionPlanningSummaryDTO = {
      orderCount: all.length,
      pendingOrderCount: all.filter(order => order.status === 'pending').length,
      scheduledOrderCount: all.filter(order => order.status === 'scheduled' || order.status === 'partially_released').length,
      thisWeekBatchCount: batches.filter(batch => batch.weekStartDate === currentStart).length,
      nextWeekBatchCount: batches.filter(batch => batch.weekStartDate === nextStart).length,
      preparationBatchCount: batches.filter(batch => batch.releaseState === 'preparation' && batch.weekStartDate === nextStart).length,
      activeBatchCount: batches.filter(batch => batch.releaseState === 'active' && batch.weekStartDate === currentStart).length,
      missingDrawingCount: all.filter(order => order.drawingFileCount === 0).length,
      missingSopCount: all.filter(order => order.sopFileCount === 0).length,
      missingProductTimeCount: all.filter(order => !order.effectiveUnitMilliseconds).length,
      warehouseExceptionCount: batches.filter(batch => batch.warehouseStatus === 'exception').length,
      processPendingCount: batches.filter(batch => batch.releaseState !== 'draft' && (batch.processStatus === 'not_created' || batch.processStatus === 'draft')).length,
    };
    const customers = [...new Set(all.map(order => order.customerName))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const [drawingProducts, salespersonRows] = await Promise.all([
      prisma.drawingLibraryItem.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          customerName: true,
          customerCode: true,
          specification: true,
          productName: true,
          files: {
            where: { deletedAt: null, isCurrent: true },
            select: { category: { select: { code: true } } },
          },
          sopDocument: {
            select: {
              sopStage: true,
              drawingStatus: true,
              remark: true,
              deletedAt: true,
              updatedAt: true,
            },
          },
          productTimeProfiles: {
            where: { status: 'published' },
            orderBy: { version: 'desc' },
            take: 1,
            select: { version: true, entries: { select: { unitMilliseconds: true } } },
          },
        },
        orderBy: [{ customerName: 'asc' }, { specification: 'asc' }],
        take: 1200,
      }),
      prisma.productionPlanOrder.findMany({
        where: { deletedAt: null, salesperson: { not: null } },
        select: { customerName: true, salesperson: true },
        orderBy: { updatedAt: 'desc' },
        take: 3000,
      }),
    ]);
    const salespersonByCustomer = new Map<string, string>();
    for (const row of salespersonRows) {
      if (row.salesperson && !salespersonByCustomer.has(row.customerName)) {
        salespersonByCustomer.set(row.customerName, row.salesperson);
      }
    }
    const productOptions: ProductionPlanProductOptionDTO[] = drawingProducts.map(item => {
      const profile = item.productTimeProfiles[0] || null;
      const sopDocument = item.sopDocument && !item.sopDocument.deletedAt ? item.sopDocument : null;
      return {
        id: item.id,
        customerName: item.customerName,
        customerCode: item.customerCode,
        specification: item.specification,
        productName: item.productName || item.specification,
        fileCount: item.files.length,
        drawingFileCount: item.files.filter(file => file.category.code === 'drawing').length,
        sopFileCount: item.files.filter(file => file.category.code === 'sop').length,
        sopStage: normalizePlanningSopStage(sopDocument?.sopStage),
        sopDrawingStatus: normalizePlanningSopDrawingStatus(sopDocument?.drawingStatus),
        sopRemark: sopDocument?.remark || null,
        sopMetadataUpdatedAt: sopDocument?.updatedAt.toISOString() || null,
        recommendedSalesperson: salespersonByCustomer.get(item.customerName) || null,
        publishedProductTimeVersion: profile?.version || null,
        unitMilliseconds: profile ? productTimeTotalMilliseconds(profile.entries) : null,
      };
    });
    return NextResponse.json({
      ok: true,
      orders: records.map(serializeProductionPlanOrder),
      summary,
      customers,
      productOptions,
      salespeople: [...new Set(salespersonRows.map(row => row.salesperson).filter((value): value is string => Boolean(value)))],
      periods: {
        current: weekSummary(currentStart, currentEnd),
        next: weekSummary(nextStart, nextEnd),
        afterNext: weekSummary(afterNextStart, afterNextEnd),
        history,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('planning order list failed', error);
    return NextResponse.json({ ok: false, error: '计划订单加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const parsed = parseProductionPlanOrderInput(body);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    const createDrawingLibraryProduct = body.createDrawingLibraryProduct === true;
    const restoreDrawingLibraryProduct = body.restoreDrawingLibraryProduct === true;
    const result = await prisma.$transaction(async tx => {
      const product = await resolveOrCreatePlanningProduct(tx, parsed.data, {
        createIfMissing: createDrawingLibraryProduct,
        restoreIfDeleted: restoreDrawingLibraryProduct,
      });
      if (product.status === 'restore_required') throw new Error('PLAN_PRODUCT_RESTORE_REQUIRED');
      const references = product.references;
      if (product.status !== 'resolved' || !references.drawingLibraryItemId || !references.customerName || !references.specification || !references.productName) {
        throw new Error('PLAN_PRODUCT_NOT_FOUND');
      }
      const canonical = {
        ...parsed.data,
        drawingLibraryItemId: references.drawingLibraryItemId,
        customerName: references.customerName,
        productName: references.productName,
        specification: references.specification,
      };
      const created = await tx.productionPlanOrder.create({
        data: {
          ...canonical,
          createdById: user.id,
          updatedById: user.id,
        },
        include: productionPlanOrderInclude,
      });
      await tx.productionPlanChange.create({
        data: {
          planOrderId: created.id,
          action: 'create_plan_order',
          afterData: planOrderSnapshot(canonical),
          actorId: user.id,
        },
      });
      await tx.operationLog.create({
        data: {
          userId: user.id,
          action: 'create_production_plan_order',
          targetType: 'production_plan_order',
          targetId: created.id,
          detail: { sourceOrderNo: created.sourceOrderNo, sourceLineNo: created.sourceLineNo },
        },
      });
      if (product.action === 'created' || product.action === 'restored') {
        await tx.operationLog.create({
          data: {
            userId: user.id,
            action: product.action === 'created'
              ? 'create_drawing_library_item_from_plan_order'
              : 'restore_drawing_library_item_from_plan_order',
            targetType: 'drawing_library_item',
            targetId: references.drawingLibraryItemId,
            detail: { source: 'production_plan_order', planOrderId: created.id },
          },
        });
      }
      return { record: created, productAction: product.action };
    });
    return NextResponse.json({
      ok: true,
      order: serializeProductionPlanOrder(result.record),
      productAction: result.productAction,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ ok: false, error: '计划订单内部编号冲突，请重试' }, { status: 409 });
    }
    if (error instanceof Error && error.message === 'PLAN_PRODUCT_NOT_FOUND') {
      return NextResponse.json({ ok: false, error: '请选择图纸资料库中的有效产品' }, { status: 400 });
    }
    if (error instanceof Error && error.message === 'PLAN_PRODUCT_RESTORE_REQUIRED') {
      return NextResponse.json({
        ok: false,
        error: '该客户和规格已在图纸资料库回收站中，确认后可恢复并继续创建订单',
        requiresProductRestore: true,
      }, { status: 409 });
    }
    if (error instanceof Error && error.message.startsWith('PLAN_PRODUCT_INVALID:')) {
      return NextResponse.json({ ok: false, error: error.message.slice('PLAN_PRODUCT_INVALID:'.length) }, { status: 400 });
    }
    console.error('create planning order failed', error);
    return NextResponse.json({ ok: false, error: '新建计划订单失败' }, { status: 500 });
  }
}
