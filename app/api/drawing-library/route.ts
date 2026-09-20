import { fixturePlanScope } from '@/lib/quality-fixture-scope';
import { drawingPlanWeekScope, planWeekStart, planWeekStartRange } from '@/lib/drawing-plan-week';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  cleanDrawingText,
  drawingLibraryItemAnomalyReason,
  drawingLibraryKey,
  invalidSpecificationReason,
  isVisibleDrawingLibraryItem,
  parseCustomerCode,
  serializeDrawingLibraryItem,
} from '@/lib/drawing-library';
import { logOp } from '@/lib/logs';
import { reconcileProductionPlanDrawingLinks } from '@/lib/planning-product-link';
import { prisma } from '@/lib/prisma';
import { DrawingLibraryResolutionError, findDrawingProductCandidates, lockDrawingProduct } from '@/lib/drawing-library-resolution';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function itemInclude(week = '') {
  return {
    documentReturns: { where: { status: { not: 'RESOLVED' } }, orderBy: { createdAt: 'desc' as const } },
    files: {
      where: { deletedAt: null },
      include: {
        category: { select: { id: true, name: true, code: true, sortOrder: true } },
        uploadedBy: { select: { displayName: true, username: true } },
        sourcePdfOverlayVersion: { select: { controlMode: true } },
        sourceSopVersion: { select: { controlMode: true } },
      },
      orderBy: [{ createdAt: 'desc' as const }],
    },
    productionPlanOrders: {
      where: { deletedAt: null, ...(week ? { status: { not: 'cancelled' } } : {}) },
      select: { id: true, batches: { where: { deletedAt: null, releaseState: { notIn: ['cancelled', 'archived'] }, ...(week ? { weekStartDate: planWeekStartRange(week) } : {}) }, select: { id: true } } },
      ...(week ? {} : { take: 1 }),
    },
    productDataRecords: {
      where: { status: 'PUBLISHED' },
      orderBy: [{ kind: 'asc' as const }, { version: 'desc' as const }],
    },
    connectorBindings: {
      where: { isCurrent: true, status: 'PUBLISHED', retiredAt: null },
      include: { connectorParameter: true },
      orderBy: [{ version: 'desc' as const }],
    },
    sopDocument: {
      select: { id: true, sopStage: true, drawingStatus: true, remark: true, deletedAt: true, updatedAt: true },
    },
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const keyword = req.nextUrl.searchParams.get('keyword')?.trim() || '';
    const filter = req.nextUrl.searchParams.get('filter') || 'all';
    const returnStatuses = filter === 'review_failed' ? ['OPEN', 'READY'] : filter === 'review_recheck' ? ['REVIEWING'] : null;
    let week = '';
    try { if (req.nextUrl.searchParams.get('week')) week = planWeekStart(req.nextUrl.searchParams.get('week')!); }
    catch { return NextResponse.json({ ok: false, error: '计划周日期无效' }, { status: 400 }); }
    const paged = req.nextUrl.searchParams.get('paged') === 'true';
    const offset = Number(req.nextUrl.searchParams.get('offset') || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) return NextResponse.json({ ok: false, error: '分页参数无效' }, { status: 400 });
    const requestedItemId = req.nextUrl.searchParams.get('itemId')?.trim() || '';
    const categories = await prisma.resourceCategory.findMany({ orderBy: { sortOrder: 'asc' } });
    const items = await prisma.drawingLibraryItem.findMany({
      where: {
        deletedAt: null,
        AND: [...(week ? [drawingPlanWeekScope(week)] : []), ...(["fixture_pending", "review_scope"].includes(filter) ? [fixturePlanScope] : [])],
        ...(filter === 'fixture_pending' ? { fixtureRequired: null } : {}),
        ...(returnStatuses ? { documentReturns: { some: { status: { in: returnStatuses } } } } : {}),
        ...(keyword
          ? {
              OR: [
                { customerName: { contains: keyword, mode: 'insensitive' } },
                { productName: { contains: keyword, mode: 'insensitive' } },
                { specification: { contains: keyword, mode: 'insensitive' } },
                { remark: { contains: keyword, mode: 'insensitive' } },
                {
                  sopDocument: {
                    is: {
                      deletedAt: null,
                      remark: { contains: keyword, mode: 'insensitive' },
                    },
                  },
                },
                {
                  files: {
                    some: {
                      deletedAt: null,
                      OR: [
                        { originalName: { contains: keyword, mode: 'insensitive' } },
                        { displayName: { contains: keyword, mode: 'insensitive' } },
                        { remark: { contains: keyword, mode: 'insensitive' } },
                      ],
                    },
                  },
                },
              ],
            }
          : {}),
      },
      include: itemInclude(week),
      orderBy: filter === 'recent' ? [{ updatedAt: 'desc' }, { id: 'asc' }] : [{ customerName: 'asc' }, { specification: 'asc' }, { id: 'asc' }],
      take: paged ? 201 : 600,
      skip: paged ? offset : 0,
    });
    const hasMore = paged && items.length > 200;
    if (hasMore) items.pop();

    const requestedItem = requestedItemId && !week && !returnStatuses
      ? await prisma.drawingLibraryItem.findFirst({
          where: { id: requestedItemId, deletedAt: null },
          include: itemInclude(),
        })
      : null;
    const mergedItems = requestedItem && !items.some(item => item.id === requestedItem.id)
      ? [requestedItem, ...items]
      : items;
    const serialized = mergedItems.map(item => ({ ...serializeDrawingLibraryItem(item, categories), ...(week ? { planBatchCount: item.productionPlanOrders.reduce((n, order) => n + order.batches.length, 0) } : {}) }));
    const filtered = serialized.filter((item, index) => {
      const rawItem = mergedItems[index];
      if (!week && !returnStatuses && rawItem.id === requestedItemId) return true;
      if (filter === 'anomaly') return !!drawingLibraryItemAnomalyReason(rawItem);
      if (!isVisibleDrawingLibraryItem(rawItem)) return false;
      if (filter === 'incomplete') return !item.isComplete;
      if (filter === 'missing_drawing') return item.missingRequiredCategories.includes('drawing');
      if (filter === 'missing_sop') return item.missingRequiredCategories.includes('sop');
      if (filter === 'missing_product') return item.missingRequiredCategories.includes('product');
      if (filter === 'complete') return item.isComplete;
      return true;
    });
    const customerMap = new Map<string, { customerName: string; customerCode: string | null; itemCount: number; missingCount: number }>();
    for (const item of filtered) {
      const key = item.customerName || '未设置';
      const current = customerMap.get(key) || { customerName: key, customerCode: item.customerCode || null, itemCount: 0, missingCount: 0 };
      current.itemCount += 1;
      if (!item.isComplete) current.missingCount += 1;
      if (!current.customerCode && item.customerCode) current.customerCode = item.customerCode;
      customerMap.set(key, current);
    }

    return NextResponse.json({
      hasMore, nextOffset: hasMore ? offset + 200 : null,
      items: filtered,
      customers: [
        { customerName: '全部客户', customerCode: null, itemCount: filtered.length, missingCount: filtered.filter(item => !item.isComplete).length },
        ...Array.from(customerMap.values()),
      ],
      categories: categories.map(category => ({ id: category.id, name: category.name, code: category.code, sortOrder: category.sortOrder })),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '图纸资料库加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const specification = cleanDrawingText(body.specification, 180);
    if (!specification) return NextResponse.json({ ok: false, error: '规格不能为空' }, { status: 400 });
    const specError = invalidSpecificationReason(specification);
    if (specError) return NextResponse.json({ ok: false, error: `规格格式异常：${specError}` }, { status: 400 });
    const customerName = cleanDrawingText(body.customerName, 160);
    if (!customerName) return NextResponse.json({ ok: false, error: '客户不能为空' }, { status: 400 });
    const productName = cleanDrawingText(body.productName, 180);
    const remark = cleanDrawingText(body.remark, 500);
    const libraryKey = drawingLibraryKey(customerName === '未设置' ? '' : customerName, specification);
    const item = await prisma.$transaction(async tx => {
      await lockDrawingProduct(tx, { customerName, specification });
      const candidates = await findDrawingProductCandidates(tx, { customerName, specification });
      if (candidates.length) throw new DrawingLibraryResolutionError(
        candidates.some(candidate => !candidate.deletedAt) ? '该客户和型号已有档案，请直接使用现有资料' : '该客户和型号的档案在回收站，请管理员恢复原档案',
        candidates.some(candidate => !candidate.deletedAt) ? 'DRAWING_LIBRARY_CONFLICT' : 'DRAWING_LIBRARY_RESTORE_REQUIRED',
        candidates.map(candidate => candidate.id),
      );
      const saved = await tx.drawingLibraryItem.create({
            data: { customerName, customerCode: parseCustomerCode(customerName), productName, specification, libraryKey, remark },
            include: itemInclude(),
          });
      await reconcileProductionPlanDrawingLinks(tx, { drawingLibraryItemId: saved.id });
      return saved;
    });
    const categories = await prisma.resourceCategory.findMany({ orderBy: { sortOrder: 'asc' } });
    await logOp({ userId: user.id, action: 'create_drawing_library_item', targetType: 'drawing_library_item', targetId: item.id, detail: { libraryKey } });
    return NextResponse.json({ ok: true, item: serializeDrawingLibraryItem(item, categories) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    if (e instanceof DrawingLibraryResolutionError) return NextResponse.json({ ok: false, error: e.message, code: e.code, itemIds: e.itemIds, itemId: e.itemIds[0] }, { status: 409 });
    if ((e as { code?: string }).code === 'P2002') return NextResponse.json({ ok: false, error: '该客户和规格已存在' }, { status: 409 });
    console.error(e);
    return NextResponse.json({ ok: false, error: '图纸资料记录创建失败' }, { status: 500 });
  }
}
