import { DOCUMENT_REVIEW_START } from '@/lib/quality-fixture-scope';
import { lockFixtureBusiness } from '@/lib/quality-fixture-service';
import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parseCustomerCode } from '@/lib/drawing-library';
import { productTimeTotalMilliseconds } from '@/lib/product-time';
import {
  automaticallyReleaseProductionPlanBatch,
  chinaDate,
  editableProductionPlanningWeek,
  planBatchSnapshot,
  refreshProductionPlanOrderStatus,
} from '@/lib/production-planning';
import {
  productionPlanImportIdentity,
  productionPlanImportLibraryKey,
  type ProductionPlanImportCandidate,
  type ProductionPlanImportProductAction,
  type ProductionPlanImportRow,
} from '@/lib/production-plan-import';
import { planningProductIdentity } from '@/lib/planning-product-link';
import { sameDrawingProduct } from '@/lib/drawing-product-identity';
import { findDrawingProductCandidates, lockDrawingProduct, requireActiveDrawing } from '@/lib/drawing-library-resolution';
import { productionPlanImportNeedsProductDecision, resolvePlanningImportTime, planningImportTimeSourceText } from '@/lib/planning-import-time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CommitBody = {
  batchId?: string;
  previewToken?: string;
  decisions?: Record<string, string>;
  orderDecisions?: Record<string, string>;
  fixtureDecisions?: Record<string, boolean>;
};

type ImportResult = {
  row: number;
  specification: string;
  status: 'created' | 'skipped';
  productAction: ProductionPlanImportProductAction;
  message: string;
};

type CommitResult = {
  targetWeekStartDate: string;
  targetWeekEndDate: string;
  summary: {
    created: number;
    skipped: number;
    failed: number;
    reusedProducts: number;
    restoredProducts: number;
    createdProducts: number;
    automaticallyActive: number;
    automaticallyPrepared: number;
    total: number;
  };
  results: ImportResult[];
};

function clean(value: unknown, max = 180): string {
  return String(value ?? '').replace(/\u00a0/g, ' ').trim().slice(0, max);
}

function jsonObject(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function previewRows(value: Prisma.JsonValue): ProductionPlanImportRow[] {
  const rows = jsonObject(value).rows;
  return Array.isArray(rows) ? rows as unknown as ProductionPlanImportRow[] : [];
}

async function loadCandidate(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<ProductionPlanImportCandidate | null> {
  const item = await tx.drawingLibraryItem.findUnique({
    where: { id },
    select: {
      fixtureRequired: true, id: true, libraryKey: true, customerName: true, customerCode: true, productName: true, specification: true, deletedAt: true,
      _count: { select: { files: { where: { deletedAt: null, isCurrent: true, category: { code: 'drawing' } } } } },
      files: { where: { deletedAt: null, isCurrent: true, category: { code: 'sop' } }, select: { id: true }, take: 1 },
      productTimeProfiles: {
        where: { status: 'published' }, orderBy: { version: 'desc' }, select: { version: true }, take: 1,
      },
    },
  });
  return item ? {
    id: item.id,
    libraryKey: item.libraryKey,
    customerName: item.customerName,
    customerCode: item.customerCode,
    productName: item.productName,
    specification: item.specification,
    deletedAt: item.deletedAt?.toISOString() || null,
    fixtureRequired: item.fixtureRequired,
    drawingFileCount: item._count.files,
    sopFileCount: item.files.length,
    productTimeVersion: item.productTimeProfiles[0]?.version || null,
  } : null;
}

async function normalizedCandidates(
  tx: Prisma.TransactionClient,
  row: ProductionPlanImportRow,
): Promise<ProductionPlanImportCandidate[]> {
  if (!row.input) return [];
  const raw = await findDrawingProductCandidates(tx, row.input);
  const loaded = await Promise.all(raw.map(item => loadCandidate(tx, item.id)));
  const identity = productionPlanImportIdentity(row.input);
  return loaded.filter((item): item is ProductionPlanImportCandidate => (
    Boolean(item) && planningProductIdentity(item!.customerName, item!.specification) === identity
  ));
}

async function resolveProduct(
  tx: Prisma.TransactionClient,
  row: ProductionPlanImportRow,
  decisionId: string | undefined,
): Promise<{ item: ProductionPlanImportCandidate; action: 'reuse' | 'restore' | 'create' }> {
  if (!row.input) throw new Error(`第 ${row.rowNo} 行缺少预检数据`);
  await lockDrawingProduct(tx, row.input);

  const selectedId = clean(decisionId, 80) || row.matchedDrawingLibraryItemId || '';
  if (row.status === 'conflict') {
    const allowedIds = new Set(row.candidates.map(candidate => candidate.id));
    if (!selectedId || !allowedIds.has(selectedId)) throw new Error(`第 ${row.rowNo} 行需要选择已有图纸库`);
  }
  if (selectedId) {
    if (!row.candidates.some(item => item.id === selectedId)) throw new Error(`第 ${row.rowNo} 行选择不属于本次预检候选，请重新预检`);
    const selected = await loadCandidate(tx, selectedId);
    if (!selected) throw new Error(`第 ${row.rowNo} 行选择的图纸库已不存在，请重新预检`);
    if (!sameDrawingProduct(selected, row.input)) throw new Error(`第 ${row.rowNo} 行图纸库客户或型号不一致，请重新预检`);
    requireActiveDrawing(selected);
    const current = (await normalizedCandidates(tx, row)).filter(item => !item.deletedAt);
    if (!decisionId && !row.input.drawingLibraryRef && current.length > 1) throw new Error(`第 ${row.rowNo} 行候选已变化，请重新预检并选择`);
    return { item: selected, action: 'reuse' };
  }

  const allCandidates = await normalizedCandidates(tx, row);
  const currentCandidates = allCandidates.filter(item => !item.deletedAt);
  if (!currentCandidates.length && allCandidates.length) requireActiveDrawing(allCandidates[0]);
  if (currentCandidates.length > 1) throw new Error(`第 ${row.rowNo} 行当前存在多个图纸库，请重新预检并选择`);
  if (currentCandidates.length === 1) {
    return { item: currentCandidates[0], action: 'reuse' };
  }

  const created = await tx.drawingLibraryItem.create({
    data: {
      customerName: row.input.customerName,
      customerCode: parseCustomerCode(row.input.customerName),
      productName: row.input.productName,
      specification: row.input.specification,
      libraryKey: productionPlanImportLibraryKey(row.input),
      remark: '由量产计划批量导入自动建档，待补图纸、SOP与产品工时',
    },
    select: { id: true },
  });
  const selected = await loadCandidate(tx, created.id);
  if (!selected) throw new Error(`第 ${row.rowNo} 行图纸库建档失败`);
  return { item: selected, action: 'create' };
}

async function commitBatch(
  batchId: string,
  previewToken: string,
  decisions: Record<string, string>,
  orderDecisions: Record<string, string>,
  userId: string,
  fixtureDecisions: Record<string, boolean>,
): Promise<CommitResult> {
  return prisma.$transaction(async tx => {
    await lockFixtureBusiness(tx);
    const fixtureChoices = new Map<string, boolean>();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`production-plan-import:${batchId}`}))`;
    const importBatch = await tx.productionPlanImportBatch.findUnique({ where: { id: batchId } });
    if (!importBatch) throw new Error('导入预检记录不存在，请重新上传文件');
    if (importBatch.previewToken !== previewToken) throw new Error('导入预览已变化，请重新上传并确认');
    if (importBatch.status === 'completed' && importBatch.resultData) {
      return importBatch.resultData as unknown as CommitResult;
    }
    if (importBatch.status !== 'previewed') throw new Error('该导入任务当前不能提交，请重新上传文件');
    const targetWeek = editableProductionPlanningWeek(chinaDate(importBatch.targetWeekStartDate));
    if (!targetWeek) throw new Error('目标生产周已经超出可编辑范围，请重新选择周次');
    const rows = previewRows(importBatch.previewData);
    if (!rows.length) throw new Error('导入预检数据为空，请重新上传文件');
    const invalid = rows.find(row => row.status === 'invalid');
    if (invalid) throw new Error(`第 ${invalid.rowNo} 行仍有错误：${invalid.reason}`);
    const unresolved = rows.find(row => productionPlanImportNeedsProductDecision(row, orderDecisions[String(row.rowNo)]) && !clean(decisions[String(row.rowNo)], 80));
    if (unresolved) throw new Error(`第 ${unresolved.rowNo} 行存在多个图纸库，请先选择后再确认`);
    for (const row of rows) {
      if (!row.requiresOrderDecision) continue;
      const choice = orderDecisions[String(row.rowNo)];
      if (choice !== 'new' && choice !== 'skip' && !row.orderCandidates?.some(order => order.id === choice)) {
        throw new Error(`第 ${row.rowNo} 行需要确认新订单、关联已有订单或跳过`);
      }
    }

    const targetWeekStartDate = chinaDate(targetWeek.start);
    const targetWeekEndDate = chinaDate(targetWeek.end);
    const results: ImportResult[] = [];
    let created = 0;
    let skipped = 0;
    let reusedProducts = 0;
    let restoredProducts = 0;
    let createdProducts = 0;
    let automaticallyActive = 0;
    let automaticallyPrepared = 0;

    for (const row of rows) {
      const orderChoice = row.requiresOrderDecision ? orderDecisions[String(row.rowNo)] : '';
      if (!row.input || row.status === 'skipped' || row.status === 'duplicate' || orderChoice === 'skip') {
        skipped += 1;
        results.push({
          row: row.rowNo,
          specification: row.input?.specification || '-',
          status: 'skipped',
          productAction: 'none',
          message: orderChoice === 'skip' ? '已按预览选择跳过' : row.reason || '该行已跳过',
        });
        continue;
      }

      const explicitOrderId = orderChoice && orderChoice !== 'new' ? orderChoice : null;
      const lockIdentity = explicitOrderId || `${row.input.sourceOrderNo}:${row.input.sourceLineNo}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`production-plan-order:${lockIdentity}`}))`;
      const existing = await tx.productionPlanOrder.findUnique({
        where: explicitOrderId ? { id: explicitOrderId } : {
          sourceOrderNo_sourceLineNo: {
            sourceOrderNo: row.input.sourceOrderNo,
            sourceLineNo: row.input.sourceLineNo,
          },
        },
        include: { batches: { orderBy: { batchNo: 'asc' } } },
      });
      if (existing && !sameDrawingProduct(existing, row.input)) throw new Error(`第 ${row.rowNo} 行原订单客户或型号不一致`);
      if (explicitOrderId && (!existing || existing.deletedAt || !sameDrawingProduct(existing, row.input))) {
        throw new Error(`第 ${row.rowNo} 行关联订单已变化，请重新预检`);
      }
      const activeBatches = existing?.batches.filter(batch => !batch.deletedAt) || [];
      if (activeBatches.some(batch => chinaDate(batch.weekStartDate) === targetWeekStartDate)) {
        skipped += 1;
        results.push({
          row: row.rowNo,
          specification: row.input.specification,
          status: 'skipped',
          productAction: 'none',
          message: '该订单行在目标周已经排产，未重复写入',
        });
        continue;
      }
      if (existing && !existing.deletedAt && (existing.status === 'cancelled' || existing.status === 'completed')) {
        throw new Error(`第 ${row.rowNo} 行关联订单已经完成或取消，不能追加批次`);
      }
      if (existing && !existing.deletedAt && activeBatches.reduce((sum, batch) => sum + batch.quantity, 0) + row.input.plannedQuantity > existing.orderQuantity) {
        throw new Error(`第 ${row.rowNo} 行排产量超过原订单剩余未排数量，请调整后重新预检`);
      }

      let product: Awaited<ReturnType<typeof resolveProduct>>;
      if (existing?.drawingLibraryItemId) {
        await lockDrawingProduct(tx, row.input);
        const linked = await loadCandidate(tx, existing.drawingLibraryItemId);
        if (!linked) throw new Error(`第 ${row.rowNo} 行原订单关联的图纸库已不存在`);
        if (!sameDrawingProduct(linked, row.input)) throw new Error(`第 ${row.rowNo} 行原订单关联的图纸库与客户或型号不一致`);
        if (decisions[String(row.rowNo)] && decisions[String(row.rowNo)] !== linked.id) throw new Error(`第 ${row.rowNo} 行已有订单不能更换产品档案`);
        product = { item: requireActiveDrawing(linked), action: 'reuse' };
      } else {
        product = await resolveProduct(tx, row, decisions[String(row.rowNo)]);
      }
      if (targetWeekStartDate >= DOCUMENT_REVIEW_START) {
        const saved = await tx.drawingLibraryItem.findUniqueOrThrow({ where: { id: product.item.id }, select: { fixtureRequired: true } });
        const choice = fixtureDecisions[String(row.rowNo)] ?? saved.fixtureRequired;
        if (typeof choice !== "boolean") throw new Error(`第 ${row.rowNo} 行请选择是否需要治具；无需治具不需填写理由`);
        if (fixtureChoices.has(product.item.id) && fixtureChoices.get(product.item.id) !== choice) throw new Error(`第 ${row.rowNo} 行与同产品其他行的治具选择不一致`);
        fixtureChoices.set(product.item.id, choice);
        if (saved.fixtureRequired !== choice) {
          await tx.drawingLibraryItem.update({ where: { id: product.item.id }, data: { fixtureRequired: choice } });
          await tx.qfEvent.create({ data: { entityType: "PRODUCT", entityId: product.item.id, action: "SET_FIXTURE_REQUIREMENT", actorId: userId, actorName: "计划导入", snapshot: { before: saved.fixtureRequired, after: choice } } });
        }
      }
      if (product.action === 'reuse') reusedProducts += 1;
      if (product.action === 'restore') restoredProducts += 1;
      if (product.action === 'create') createdProducts += 1;

      const profile = await tx.productTimeProfile.findFirst({
        where: { drawingLibraryItemId: product.item.id, status: 'published' },
        orderBy: { version: 'desc' },
        select: { id: true, version: true, entries: { select: { unitMilliseconds: true } } },
      });
      const publishedMilliseconds = profile?.entries.length ? productTimeTotalMilliseconds(profile.entries) : null;
      const planTime = resolvePlanningImportTime({ imported: row.input.planningUnitMilliseconds, published: publishedMilliseconds, order: existing?.planningUnitMilliseconds, quantity: row.input.plannedQuantity });
      const previewProduct = row.candidates.find(item => item.id === product.item.id);
      const previewOrder = row.orderCandidates?.find(order => order.id === existing?.id);
      const previewTime = resolvePlanningImportTime({ imported: row.input.planningUnitMilliseconds, published: explicitOrderId ? previewOrder?.productUnitMilliseconds : previewProduct?.productUnitMilliseconds, order: previewOrder?.planningUnitMilliseconds, quantity: row.input.plannedQuantity });
      if (row.timePreview && planTime.unitMilliseconds !== (explicitOrderId || row.status === 'conflict' ? previewTime.unitMilliseconds : row.timePreview.unitMilliseconds)) {
        throw new Error(`第 ${row.rowNo} 行计划工时已变化，请重新预检核对`);
      }
      const unitMilliseconds = planTime.unitMilliseconds;
      const restoringOrder = Boolean(existing?.deletedAt);
      const nextBatchNo = existing ? Math.max(0, ...existing.batches.map(batch => batch.batchNo)) + 1 : 1;
      const customerDueDate = existing?.customerDueDate || new Date(`${row.input.customerDueDate}T12:00:00+08:00`);
      const plannedCompletionDate = new Date(`${row.input.plannedCompletionDate}T12:00:00+08:00`);
      const canonicalProductName = product.item.productName || row.input.productName;
      const planOrder = existing
        ? await tx.productionPlanOrder.update({
            where: { id: existing.id },
            data: {
              customerName: product.item.customerName,
              productName: canonicalProductName,
              specification: product.item.specification,
              drawingLibraryItemId: product.item.id,
              salesperson: existing.salesperson || row.input.salesperson,
              orderQuantity: existing.orderQuantity,
              planningUnitMilliseconds: existing.planningUnitMilliseconds || unitMilliseconds,
              status: 'scheduled',
              remark: row.input.remark || existing.remark,
              deletedAt: null,
              updatedById: userId,
            },
          })
        : await tx.productionPlanOrder.create({
            data: {
              sourceOrderNo: row.input.sourceOrderNo,
              sourceLineNo: row.input.sourceLineNo,
              customerName: product.item.customerName,
              salesperson: row.input.salesperson,
              productName: canonicalProductName,
              specification: product.item.specification,
              drawingLibraryItemId: product.item.id,
              orderQuantity: row.input.orderQuantity,
              planningUnitMilliseconds: unitMilliseconds,
              orderDate: new Date(`${row.input.orderDate}T12:00:00+08:00`),
              customerDueDate,
              customerDueDateConfirmed: true,
              priority: 'normal',
              status: 'scheduled',
              remark: row.input.remark,
              createdById: userId,
              updatedById: userId,
            },
          });
      const batch = await tx.productionPlanBatch.create({
        data: {
          planOrderId: planOrder.id,
          batchNo: nextBatchNo,
          quantity: row.input.plannedQuantity,
          weekStartDate: targetWeek.start,
          weekEndDate: targetWeek.end,
          plannedCompletionDate,
          productTimeProfileId: profile?.id || null,
          productTimeProfileVersion: profile?.version || null,
          unitMillisecondsSnapshot: unitMilliseconds,
          importedUnitMilliseconds: row.input.planningUnitMilliseconds || null,
          planTimeSource: planTime.source,
          totalMillisecondsSnapshot: unitMilliseconds ? BigInt(unitMilliseconds) * BigInt(row.input.plannedQuantity) : null,
        },
      });
      await refreshProductionPlanOrderStatus(tx, planOrder.id);
      await tx.productionPlanChange.create({
        data: {
          planOrderId: planOrder.id,
          batchId: batch.id,
          action: restoringOrder ? 'restore_deleted_plan_order_from_bulk_import' : 'bulk_import_plan_week',
          afterData: planBatchSnapshot({
            quantity: row.input.plannedQuantity,
            weekStartDate: targetWeek.start,
            weekEndDate: targetWeek.end,
            plannedCompletionDate,
            unitMilliseconds,
            batchNo: nextBatchNo,
            releaseState: 'draft',
          }),
          impactData: {
            importBatchId: importBatch.id,
            sourceFileName: importBatch.sourceFileName,
            sourceSheetName: importBatch.sourceSheetName,
            sourceRowNo: row.rowNo,
            productAction: product.action,
            drawingLibraryItemId: product.item.id,
            targetWeekStartDate,
            planningTime: { ...planTime, importedUnitMilliseconds: row.input.planningUnitMilliseconds || null, productTimeProfileVersion: profile?.version || null },
            orderChoice: explicitOrderId ? 'existing' : row.input.sourceIdentity || 'provided',
          },
          reason: `量产计划批量导入到 ${targetWeekStartDate} 周`,
          actorId: userId,
        },
      });
      const automaticRelease = await automaticallyReleaseProductionPlanBatch(tx, {
        batchId: batch.id,
        actorId: userId,
        trigger: 'automatic_schedule',
      });
      if (automaticRelease?.target === 'active') automaticallyActive += 1;
      if (automaticRelease?.target === 'preparation') automaticallyPrepared += 1;
      created += 1;
      results.push({
        row: row.rowNo,
        specification: product.item.specification,
        status: 'created',
        productAction: product.action,
        message: (product.action === 'create'
          ? '已新建空白图纸库并绑定排产'
          : product.action === 'restore'
            ? '已恢复原图纸库并绑定排产'
            : '已复用原图纸库及其图纸、SOP和工时') + `；计划工时：${planningImportTimeSourceText[planTime.source]}`,
      });
    }

    const result: CommitResult = {
      targetWeekStartDate,
      targetWeekEndDate,
      summary: {
        created,
        skipped,
        failed: 0,
        reusedProducts,
        restoredProducts,
        createdProducts,
        automaticallyActive,
        automaticallyPrepared,
        total: rows.length,
      },
      results,
    };
    await tx.productionPlanImportBatch.update({
      where: { id: importBatch.id },
      data: {
        status: 'completed',
        decisions: { products: decisions, orders: orderDecisions, fixtures: fixtureDecisions } as unknown as Prisma.InputJsonValue,
        resultData: result as unknown as Prisma.InputJsonValue,
        errorMessage: null,
        committedAt: new Date(),
      },
    });
    await tx.operationLog.create({
      data: {
        userId,
        action: 'bulk_import_production_plan',
        targetType: 'production_plan_import_batch',
        targetId: importBatch.id,
        detail: {
          requestId: importBatch.requestId,
          sourceFileName: importBatch.sourceFileName,
          targetWeekStartDate,
          targetWeekEndDate,
          ...result.summary,
        },
      },
    });
    return result;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 120_000,
  });
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as CommitBody;
    const batchId = clean(body.batchId, 80);
    const previewToken = clean(body.previewToken, 80);
    if (!batchId || !previewToken) {
      return NextResponse.json({ ok: false, error: '缺少导入预检凭证，请重新上传文件' }, { status: 400 });
    }
    const decisions = body.decisions && typeof body.decisions === 'object' ? body.decisions : {};
    const orderDecisions = body.orderDecisions && typeof body.orderDecisions === 'object' ? body.orderDecisions : {};
    const result = await commitBatch(batchId, previewToken, decisions, orderDecisions, user.id, body.fixtureDecisions || {});
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return NextResponse.json({ ok: false, error: '导入期间数据被其他操作更新，请重新提交；系统未写入半批数据' }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : '量产计划批量导入失败';
    console.error('production plan bulk import failed', error);
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
}
