import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  drawingLibraryKey,
  invalidSpecificationReason,
  parseCustomerCode,
} from '@/lib/drawing-library';
import { startConfirmedProcessRoute } from '@/lib/process-route-service';
import { processRouteExecutionReadiness } from '@/lib/process-route-readiness';
import { shouldSynchronizeDrawingReleaseStatus } from '@/lib/production-drawing-readiness';
import { createWorkOrderProcessRoute } from '@/lib/process-routing';
import { allocateBusinessWorkOrderCode } from '@/lib/work-order-business-code';
import { productTimeTotalMilliseconds } from '@/lib/product-time';
import {
  normalizePlanningSopDrawingStatus,
  normalizePlanningSopStage,
  planningSopRequiresReleaseConfirmation,
} from '@/lib/planning-sop';
import { normalizeWorkOrderStage } from '@/lib/work-orders';
import type {
  ProductionPlanBatchDTO,
  ProductionPlanChangeDTO,
  ProductionPlanOrderDTO,
  ProductionPlanOrderStatus,
  ProductionPlanPriority,
  ProductionPlanReleaseState,
  SopDrawingStatusDTO,
  SopStageDTO,
} from '@/types';

export const productionPlanOrderInclude = {
  drawingLibraryItem: {
    select: {
      id: true,
      deletedAt: true,
      files: {
        where: { deletedAt: null, isCurrent: true, category: { code: { in: ['drawing', 'sop'] } } },
        orderBy: { createdAt: 'desc' as const },
        select: {
          id: true,
          version: true,
          updatedAt: true,
          category: { select: { code: true } },
        },
      },
      productTimeProfiles: {
        where: { status: 'published' },
        orderBy: { version: 'desc' as const },
        take: 1,
        select: {
          id: true,
          version: true,
          entries: { select: { unitMilliseconds: true } },
        },
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
    },
  },
  batches: {
    where: { deletedAt: null },
    orderBy: [{ weekStartDate: 'asc' as const }, { batchNo: 'asc' as const }],
    include: {
      workOrder: {
        select: {
          id: true,
          startedAt: true,
          completedAt: true,
          materialTask: {
            select: {
              status: true,
              completedAt: true,
            },
          },
          processRoute: {
            select: {
              id: true,
              version: true,
              status: true,
              confirmedAt: true,
              startedAt: true,
              completedAt: true,
              steps: {
                where: { retiredAt: null },
                orderBy: { position: 'asc' as const },
                select: {
                  processName: true,
                  status: true,
                  startedAt: true,
                  completedAt: true,
                },
              },
            },
          },
          qrTicket: {
            select: {
              prints: {
                orderBy: { printedAt: 'desc' as const },
                take: 1,
                select: {
                  id: true,
                  status: true,
                  mode: true,
                  routeVersion: true,
                  drawingFileId: true,
                  drawingFileVersion: true,
                  sopFileId: true,
                  sopFileVersion: true,
                  snapshot: true,
                  printedAt: true,
                  confirmedAt: true,
                  items: {
                    select: {
                      material: true,
                      status: true,
                      copies: true,
                      fileId: true,
                      fileVersion: true,
                      confirmedAt: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ProductionPlanOrderInclude;

export const productionPlanChangeInclude = {
  actor: { select: { id: true, username: true, displayName: true } },
} satisfies Prisma.ProductionPlanChangeInclude;

export type ProductionPlanOrderRecord = Prisma.ProductionPlanOrderGetPayload<{
  include: typeof productionPlanOrderInclude;
}>;

export type ProductionPlanChangeRecord = Prisma.ProductionPlanChangeGetPayload<{
  include: typeof productionPlanChangeInclude;
}>;

export type ProductionPlanOrderInput = {
  drawingLibraryItemId?: unknown;
  sourceOrderNo?: unknown;
  sourceLineNo?: unknown;
  customerName?: unknown;
  salesperson?: unknown;
  productName?: unknown;
  specification?: unknown;
  orderQuantity?: unknown;
  planningUnitMilliseconds?: unknown;
  orderDate?: unknown;
  customerDueDate?: unknown;
  priority?: unknown;
  status?: unknown;
  remark?: unknown;
};

export type ProductionPlanBatchInput = {
  quantity?: unknown;
  weekStartDate?: unknown;
  plannedCompletionDate?: unknown;
  unitMilliseconds?: unknown;
};

export type ParsedPlanOrder = {
  drawingLibraryItemId: string | null;
  sourceOrderNo: string;
  sourceLineNo: number;
  customerName: string;
  salesperson: string | null;
  productName: string;
  specification: string;
  orderQuantity: number;
  planningUnitMilliseconds: number | null;
  orderDate: Date;
  customerDueDate: Date;
  priority: ProductionPlanPriority;
  status: ProductionPlanOrderStatus;
  remark: string | null;
};

export type ParsedPlanBatch = {
  quantity: number;
  weekStartDate: Date;
  weekEndDate: Date;
  plannedCompletionDate: Date;
  unitMilliseconds: number | null;
};

export type PlanningProductReferenceAction = 'existing' | 'created' | 'restored';

export type PlanningProductReferenceResult = {
  status: 'resolved' | 'missing' | 'restore_required';
  action: PlanningProductReferenceAction | null;
  drawingLibraryItemId: string | null;
  references: Awaited<ReturnType<typeof resolvePlanningReferences>>;
};

export type ProductionPlanReleasePreview = {
  target: 'preparation' | 'active';
  targetWeekStartDate: string;
  targetWeekEndDate: string;
  batchCount: number;
  totalQuantity: number;
  warnings: number;
  blockers: number;
  validatingSopCount: number;
  items: Array<{
    batchId: string;
    specification: string;
    quantity: number;
    warnings: string[];
    blockers: string[];
    sopStage: SopStageDTO | null;
    sopRemark: string | null;
    sopMetadataUpdatedAt: string | null;
    sopValidationRequired: boolean;
  }>;
};

export type ProductionPlanDeletionWorkOrderState = {
  stage: string;
  status: string;
  progress: number;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  lastProgressAt: Date | string | null;
  completedQty: string | null;
  frontendTransferredQty: number | null;
  progressLogCount: number;
  processRoute: {
    status: string;
    startedAt: Date | string | null;
    completedAt: Date | string | null;
    steps: Array<{
      status: string;
      startedAt: Date | string | null;
      completedAt: Date | string | null;
      executionCount: number;
    }>;
  } | null;
};

export type ProductionPlanBatchDeletionPreview = {
  batchCount: number;
  totalQuantity: number;
  draftDeleteCount: number;
  withdrawCount: number;
  blockers: number;
  items: Array<{
    batchId: string;
    specification: string;
    quantity: number;
    action: 'delete_draft' | 'withdraw_unstarted' | 'blocked';
    message: string;
  }>;
};

export type ProductionPlanOrderDeletionDisposition = {
  nextOrderQuantity: number;
  activeBatchQuantity: number;
  removedBatchQuantity: number;
  shouldDeleteOrder: boolean;
};

function text(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function positiveMilliseconds(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 86_400_000 ? parsed : null;
}

function hasInputValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

export function parsePlanDate(value: unknown): Date | null {
  const source = text(value, 40);
  if (!source) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(source)
    ? new Date(`${source}T12:00:00+08:00`)
    : new Date(source);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function chinaDate(value: Date | null | undefined): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value);
}

export function chinaWeekRange(input: Date): { start: Date; end: Date } {
  const dateText = chinaDate(input);
  const local = new Date(`${dateText}T12:00:00+08:00`);
  const day = local.getUTCDay();
  const distance = day === 0 ? -6 : 1 - day;
  const start = new Date(local);
  start.setUTCDate(start.getUTCDate() + distance);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start, end };
}

const PLANNING_DAY_MILLISECONDS = 86_400_000;

function addPlanningDays(value: Date, days: number): Date {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

export function productionPlanTargetWeek(
  target: 'preparation' | 'active',
  now = new Date(),
): { start: Date; end: Date } {
  const current = chinaWeekRange(now);
  if (target === 'active') return current;
  return { start: addPlanningDays(current.start, 7), end: addPlanningDays(current.end, 7) };
}

export type AutomaticProductionPlanReleaseTarget = 'preparation' | 'active';

export function automaticProductionPlanReleaseTarget(
  batch: {
    weekStartDate: Date;
    releaseState: string;
    workOrderId?: string | null;
  },
  now = new Date(),
): AutomaticProductionPlanReleaseTarget | null {
  if (batch.releaseState === 'archived') return null;
  const weekStartDate = chinaDate(batch.weekStartDate);
  const currentWeekStartDate = chinaDate(productionPlanTargetWeek('active', now).start);
  if (weekStartDate === currentWeekStartDate) {
    if (batch.releaseState === 'draft' || batch.releaseState === 'preparation') return 'active';
    if (batch.releaseState === 'active' && !batch.workOrderId) return 'active';
    return null;
  }
  const nextWeekStartDate = chinaDate(productionPlanTargetWeek('preparation', now).start);
  if (weekStartDate === nextWeekStartDate) {
    if (batch.releaseState === 'draft') return 'preparation';
    if (batch.releaseState === 'preparation' && !batch.workOrderId) return 'preparation';
  }
  return null;
}

export function alignProductionPlanBatchWeek(
  batch: Pick<ParsedPlanBatch, 'weekStartDate' | 'plannedCompletionDate'>,
  target: 'preparation' | 'active',
  now = new Date(),
): { weekStartDate: Date; weekEndDate: Date; plannedCompletionDate: Date } {
  const source = chinaWeekRange(batch.weekStartDate);
  const targetWeek = productionPlanTargetWeek(target, now);
  const rawOffset = Math.round(
    (batch.plannedCompletionDate.getTime() - source.start.getTime()) / PLANNING_DAY_MILLISECONDS,
  );
  const completionOffset = Math.max(0, Math.min(6, rawOffset));
  return {
    weekStartDate: targetWeek.start,
    weekEndDate: targetWeek.end,
    plannedCompletionDate: addPlanningDays(targetWeek.start, completionOffset),
  };
}

export function moveProductionPlanBatchToWeek(
  batch: Pick<ParsedPlanBatch, 'weekStartDate' | 'plannedCompletionDate'>,
  targetWeekStartDate: Date,
): { weekStartDate: Date; weekEndDate: Date; plannedCompletionDate: Date } {
  const sourceWeek = chinaWeekRange(batch.weekStartDate);
  const targetWeek = chinaWeekRange(targetWeekStartDate);
  const rawOffset = Math.round(
    (batch.plannedCompletionDate.getTime() - sourceWeek.start.getTime()) / PLANNING_DAY_MILLISECONDS,
  );
  const completionOffset = Math.max(0, Math.min(6, rawOffset));
  return {
    weekStartDate: targetWeek.start,
    weekEndDate: targetWeek.end,
    plannedCompletionDate: addPlanningDays(targetWeek.start, completionOffset),
  };
}

export function editableProductionPlanningWeek(
  value: unknown,
  now = new Date(),
): { start: Date; end: Date } | null {
  const requested = parsePlanDate(value);
  if (!requested) return null;
  const requestedWeek = chinaWeekRange(requested);
  const currentWeek = chinaWeekRange(now);
  const lastEditableStart = addPlanningDays(currentWeek.start, 14);
  if (requestedWeek.start < currentWeek.start || requestedWeek.start > lastEditableStart) return null;
  return requestedWeek;
}

function planPriority(value: unknown): ProductionPlanPriority {
  const source = text(value, 20);
  if (source === 'urgent' || source === 'insert') return source;
  return 'normal';
}

function planOrderStatus(value: unknown): ProductionPlanOrderStatus {
  const source = text(value, 30) as ProductionPlanOrderStatus;
  const values: ProductionPlanOrderStatus[] = ['pending', 'scheduled', 'partially_released', 'released', 'paused', 'cancelled', 'completed'];
  return values.includes(source) ? source : 'pending';
}

export function parseProductionPlanOrderInput(
  input: ProductionPlanOrderInput,
  current?: ParsedPlanOrder,
): { ok: true; data: ParsedPlanOrder } | { ok: false; error: string } {
  const suppliedSourceOrderNo = input.sourceOrderNo === undefined && current ? current.sourceOrderNo : text(input.sourceOrderNo, 120);
  const sourceOrderNo = suppliedSourceOrderNo || `PLAN-${randomUUID()}`;
  const sourceLineNo = input.sourceLineNo === undefined && current ? current.sourceLineNo : positiveInteger(input.sourceLineNo) || 1;
  const drawingLibraryItemId = input.drawingLibraryItemId === undefined && current
    ? current.drawingLibraryItemId
    : text(input.drawingLibraryItemId, 80) || null;
  const customerName = input.customerName === undefined && current ? current.customerName : text(input.customerName, 120);
  const salesperson = input.salesperson === undefined && current ? current.salesperson : text(input.salesperson, 80) || null;
  const productName = input.productName === undefined && current ? current.productName : text(input.productName, 160);
  const specification = input.specification === undefined && current ? current.specification : text(input.specification, 180);
  const orderQuantity = input.orderQuantity === undefined && current ? current.orderQuantity : positiveInteger(input.orderQuantity);
  const planningUnitMilliseconds = input.planningUnitMilliseconds === undefined && current
    ? current.planningUnitMilliseconds
    : positiveMilliseconds(input.planningUnitMilliseconds);
  const orderDate = input.orderDate === undefined && current ? current.orderDate : parsePlanDate(input.orderDate);
  const customerDueDate = input.customerDueDate === undefined && current ? current.customerDueDate : parsePlanDate(input.customerDueDate);
  const priority = input.priority === undefined && current ? current.priority : planPriority(input.priority);
  const status = input.status === undefined && current ? current.status : planOrderStatus(input.status);
  const remark = input.remark === undefined && current ? current.remark : text(input.remark, 500) || null;

  if (!customerName) return { ok: false, error: '请填写客户名称' };
  if (!productName) return { ok: false, error: '请填写产品名称' };
  if (!specification) return { ok: false, error: '请填写产品规格' };
  if (!orderQuantity) return { ok: false, error: '订单数量必须是正整数' };
  if (hasInputValue(input.planningUnitMilliseconds) && !planningUnitMilliseconds) {
    return { ok: false, error: '单件产品工时必须大于 0 且不超过 24 小时' };
  }
  if (!orderDate) return { ok: false, error: '下单日期格式不正确' };
  if (!customerDueDate) return { ok: false, error: '客户交期格式不正确' };
  if (customerDueDate < orderDate) return { ok: false, error: '客户交期不能早于下单日期' };
  return {
    ok: true,
    data: { drawingLibraryItemId, sourceOrderNo, sourceLineNo, customerName, salesperson, productName, specification, orderQuantity, planningUnitMilliseconds, orderDate, customerDueDate, priority, status, remark },
  };
}

export function parseProductionPlanBatchInput(
  input: ProductionPlanBatchInput,
  current?: ParsedPlanBatch,
): { ok: true; data: ParsedPlanBatch } | { ok: false; error: string } {
  const quantity = input.quantity === undefined && current ? current.quantity : positiveInteger(input.quantity);
  const unitMilliseconds = input.unitMilliseconds === undefined
    ? current?.unitMilliseconds || null
    : positiveMilliseconds(input.unitMilliseconds);
  const weekInput = input.weekStartDate === undefined && current ? current.weekStartDate : parsePlanDate(input.weekStartDate);
  const plannedCompletionDate = input.plannedCompletionDate === undefined && current
    ? current.plannedCompletionDate
    : parsePlanDate(input.plannedCompletionDate);
  if (!quantity) return { ok: false, error: '排产数量必须是正整数' };
  if (hasInputValue(input.unitMilliseconds) && !unitMilliseconds) {
    return { ok: false, error: '单根工时必须大于 0 且不超过 24 小时' };
  }
  if (!weekInput) return { ok: false, error: '请选择排产周' };
  if (!plannedCompletionDate) return { ok: false, error: '请选择内部计划完成日期' };
  const range = chinaWeekRange(weekInput);
  if (plannedCompletionDate < range.start || plannedCompletionDate > range.end) {
    return { ok: false, error: '内部计划完成日期必须位于所选生产周内' };
  }
  return { ok: true, data: { quantity, weekStartDate: range.start, weekEndDate: range.end, plannedCompletionDate, unitMilliseconds } };
}

export function effectivePlanningUnitMilliseconds(
  batchUnitMilliseconds?: number | null,
  productUnitMilliseconds?: number | null,
  orderUnitMilliseconds?: number | null,
): number | null {
  return positiveMilliseconds(batchUnitMilliseconds)
    || positiveMilliseconds(productUnitMilliseconds)
    || positiveMilliseconds(orderUnitMilliseconds)
    || null;
}

export async function resolvePlanningReferences(
  tx: Pick<Prisma.TransactionClient, 'drawingLibraryItem'>,
  input: { drawingLibraryItemId?: string | null; customerName: string; specification: string },
): Promise<{
  drawingLibraryItemId: string | null;
  customerName: string | null;
  productName: string | null;
  specification: string | null;
  productTimeProfileId: string | null;
  productTimeProfileVersion: number | null;
  unitMilliseconds: number | null;
  drawingFileCount: number;
  sopFileCount: number;
  drawingFileId: string | null;
  drawingFileVersion: string | null;
  sopFileId: string | null;
  sopFileVersion: string | null;
  sopStage: SopStageDTO | null;
  sopDrawingStatus: SopDrawingStatusDTO | null;
  sopRemark: string | null;
  sopMetadataUpdatedAt: string | null;
}> {
  const itemId = text(input.drawingLibraryItemId, 80);
  const key = drawingLibraryKey(input.customerName, input.specification);
  const drawing = await tx.drawingLibraryItem.findFirst({
    where: {
      deletedAt: null,
      ...(itemId
        ? { id: itemId }
        : {
            OR: [
              { libraryKey: key },
              { customerName: input.customerName, specification: input.specification },
            ],
          }),
    },
    select: {
      id: true,
      customerName: true,
      productName: true,
      specification: true,
      files: {
        where: { deletedAt: null, isCurrent: true, category: { code: { in: ['drawing', 'sop'] } } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          version: true,
          category: { select: { code: true } },
        },
      },
      productTimeProfiles: {
        where: { status: 'published' },
        orderBy: { version: 'desc' },
        take: 1,
        select: { id: true, version: true, entries: { select: { unitMilliseconds: true } } },
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
    },
  });
  const profile = drawing?.productTimeProfiles[0] || null;
  const resourceFiles = drawing?.files || [];
  const drawingFiles = resourceFiles.filter(file => file.category.code === 'drawing');
  const sopFiles = resourceFiles.filter(file => file.category.code === 'sop');
  const currentDrawing = drawingFiles[0] || null;
  const currentSop = sopFiles[0] || null;
  const sopDocument = drawing?.sopDocument && !drawing.sopDocument.deletedAt
    ? drawing.sopDocument
    : null;
  return {
    drawingLibraryItemId: drawing?.id || null,
    customerName: drawing?.customerName || null,
    productName: drawing?.productName || drawing?.specification || null,
    specification: drawing?.specification || null,
    productTimeProfileId: profile?.id || null,
    productTimeProfileVersion: profile?.version || null,
    unitMilliseconds: profile ? productTimeTotalMilliseconds(profile.entries) : null,
    drawingFileCount: drawingFiles.length,
    sopFileCount: sopFiles.length,
    drawingFileId: currentDrawing?.id || null,
    drawingFileVersion: currentDrawing?.version || null,
    sopFileId: currentSop?.id || null,
    sopFileVersion: currentSop?.version || null,
    sopStage: normalizePlanningSopStage(sopDocument?.sopStage),
    sopDrawingStatus: normalizePlanningSopDrawingStatus(sopDocument?.drawingStatus),
    sopRemark: sopDocument?.remark || null,
    sopMetadataUpdatedAt: sopDocument?.updatedAt.toISOString() || null,
  };
}

export function buildPlanningDrawingLibraryItemData(input: Pick<ParsedPlanOrder, 'customerName' | 'productName' | 'specification'>):
  | { ok: true; data: { customerName: string; customerCode: string | null; productName: string; specification: string; libraryKey: string; remark: string } }
  | { ok: false; error: string } {
  const customerName = text(input.customerName, 120);
  const productName = text(input.productName, 160);
  const specification = text(input.specification, 180);
  if (!customerName) return { ok: false, error: '请填写客户名称' };
  if (!productName) return { ok: false, error: '请填写产品名称' };
  if (!specification) return { ok: false, error: '请填写产品规格' };
  const specificationError = invalidSpecificationReason(specification);
  if (specificationError) return { ok: false, error: specificationError };
  return {
    ok: true,
    data: {
      customerName,
      customerCode: parseCustomerCode(customerName),
      productName,
      specification,
      libraryKey: drawingLibraryKey(customerName, specification),
      remark: '由计划中心自动建档，待补图纸资料',
    },
  };
}

export async function resolveOrCreatePlanningProduct(
  tx: Pick<Prisma.TransactionClient, 'drawingLibraryItem'>,
  input: ParsedPlanOrder,
  options: { createIfMissing: boolean; restoreIfDeleted: boolean },
): Promise<PlanningProductReferenceResult> {
  const references = await resolvePlanningReferences(tx, input);
  if (references.drawingLibraryItemId) {
    await tx.drawingLibraryItem.updateMany({
      where: {
        id: references.drawingLibraryItemId,
        deletedAt: null,
        OR: [{ remark: null }, { remark: '' }, { remark: '-' }],
      },
      data: { remark: '由计划中心关联建档，待补图纸资料' },
    });
    return {
      status: 'resolved',
      action: 'existing',
      drawingLibraryItemId: references.drawingLibraryItemId,
      references,
    };
  }
  if (!options.createIfMissing) {
    return { status: 'missing', action: null, drawingLibraryItemId: null, references };
  }

  const createData = buildPlanningDrawingLibraryItemData(input);
  if (!createData.ok) throw new Error(`PLAN_PRODUCT_INVALID:${createData.error}`);
  const existing = await tx.drawingLibraryItem.findUnique({
    where: { libraryKey: createData.data.libraryKey },
    select: { id: true, deletedAt: true },
  });
  if (existing?.deletedAt && !options.restoreIfDeleted) {
    return {
      status: 'restore_required',
      action: null,
      drawingLibraryItemId: existing.id,
      references,
    };
  }

  const action: PlanningProductReferenceAction = existing?.deletedAt
    ? 'restored'
    : existing
      ? 'existing'
      : 'created';
  const drawing = await tx.drawingLibraryItem.upsert({
    where: { libraryKey: createData.data.libraryKey },
    create: createData.data,
    update: existing?.deletedAt && options.restoreIfDeleted
      ? {
          deletedAt: null,
          customerName: createData.data.customerName,
          customerCode: createData.data.customerCode,
          productName: createData.data.productName,
          specification: createData.data.specification,
          remark: createData.data.remark,
        }
      : {},
    select: { id: true },
  });
  const resolved = await resolvePlanningReferences(tx, {
    drawingLibraryItemId: drawing.id,
    customerName: createData.data.customerName,
    specification: createData.data.specification,
  });
  return {
    status: 'resolved',
    action,
    drawingLibraryItemId: drawing.id,
    references: resolved,
  };
}

export async function previewProductionPlanRelease(
  tx: Prisma.TransactionClient,
  input: { batchIds: string[]; target: 'preparation' | 'active'; now?: Date },
): Promise<ProductionPlanReleasePreview> {
  const batches = await tx.productionPlanBatch.findMany({
    where: { id: { in: input.batchIds }, deletedAt: null, planOrder: { deletedAt: null } },
    include: { planOrder: true },
  });
  if (batches.length !== input.batchIds.length) throw new Error('PLAN_BATCH_SELECTION_INVALID');

  const targetWeek = productionPlanTargetWeek(input.target, input.now);
  const items: ProductionPlanReleasePreview['items'] = [];
  for (const batch of batches) {
    const refs = await resolvePlanningReferences(tx, batch.planOrder);
    const effectiveUnitMilliseconds = effectivePlanningUnitMilliseconds(
      batch.unitMillisecondsSnapshot,
      refs.unitMilliseconds,
      batch.planOrder.planningUnitMilliseconds,
    );
    const warnings: string[] = [];
    const blockers: string[] = [];
    if (batch.releaseState === 'archived') blockers.push('该批次已经归档');
    const transitionBlocker = productionPlanReleaseTransitionBlocker(
      batch.releaseState,
      input.target,
    );
    if (transitionBlocker) blockers.push(transitionBlocker);
    else if (batch.releaseState !== 'draft' && batch.releaseState !== input.target) {
      warnings.push(`当前已处于${batch.releaseState === 'active' ? '本周执行' : '下周预备'}状态`);
    }
    if (chinaDate(batch.weekStartDate) !== chinaDate(targetWeek.start)) {
      warnings.push(
        `生产周将调整为${input.target === 'active' ? '本周' : '下周'} ${chinaDate(targetWeek.start)} 至 ${chinaDate(targetWeek.end)}`,
      );
    }
    if (!refs.drawingLibraryItemId) warnings.push('未匹配产品资料档案：工单可先进入配料，但生产启动前必须补齐原图和 SOP');
    else {
      if (!refs.drawingFileCount) warnings.push('原图尚未上传：工单可先进入配料，但生产启动前必须补齐');
      if (!refs.sopFileCount) warnings.push('SOP作业指导书尚未上传：工单可先进入配料，但生产启动前必须补齐');
    }
    if (!refs.productTimeProfileId) {
      warnings.push('产品工序与工时尚未发布：可先下达仓库配料，生产启动前必须补齐');
    } else if (!effectiveUnitMilliseconds) {
      warnings.push('已发布产品工时暂无有效总工时：可先下达仓库配料，生产启动前必须修正');
    }
    const sopValidationRequired = planningSopRequiresReleaseConfirmation(refs.sopStage);
    if (sopValidationRequired) {
      warnings.push(`SOP处于验证中：${refs.sopRemark || '请确认验证范围和使用条件'}`);
    }
    items.push({
      batchId: batch.id,
      specification: batch.planOrder.specification,
      quantity: batch.quantity,
      warnings,
      blockers,
      sopStage: refs.sopStage,
      sopRemark: refs.sopRemark,
      sopMetadataUpdatedAt: refs.sopMetadataUpdatedAt,
      sopValidationRequired,
    });
  }
  return {
    target: input.target,
    targetWeekStartDate: chinaDate(targetWeek.start),
    targetWeekEndDate: chinaDate(targetWeek.end),
    batchCount: items.length,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    warnings: items.reduce((sum, item) => sum + item.warnings.length, 0),
    blockers: items.reduce((sum, item) => sum + item.blockers.length, 0),
    validatingSopCount: items.filter(item => item.sopValidationRequired).length,
    items,
  };
}

export function productionPlanReleaseTransitionBlocker(
  releaseState: string,
  target: 'preparation' | 'active',
): string | null {
  if (releaseState === 'active' && target === 'preparation') {
    return '本周执行批次不能退回下周预备；未开工批次请使用撤回流程，已开工批次必须继续闭环';
  }
  return null;
}

export function productionPlanProductIdentityLocked(input: {
  hasReleasedBatch: boolean;
  identityChanged: boolean;
}): boolean {
  return input.hasReleasedBatch && input.identityChanged;
}

export function releasedBatchWeekChangeLocked(input: {
  released: boolean;
  weekStartChanged: boolean;
  weekEndChanged: boolean;
}): boolean {
  return input.released && (input.weekStartChanged || input.weekEndChanged);
}

function storedPositiveQuantity(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0];
  return normalized ? Number(normalized) > 0 : false;
}

export function productionPlanWorkOrderStartBlocker(
  workOrder: ProductionPlanDeletionWorkOrderState | null,
): string | null {
  if (!workOrder) return null;
  if (workOrder.completedAt || workOrder.stage === 'completed' || workOrder.status === 'done') {
    return '关联生产工单已经完成，不能删除计划';
  }
  if (
    workOrder.startedAt
    || workOrder.lastProgressAt
    || workOrder.progress > 0
    || (workOrder.frontendTransferredQty || 0) > 0
    || storedPositiveQuantity(workOrder.completedQty)
    || workOrder.progressLogCount > 0
    || (workOrder.stage !== 'not_issued' && workOrder.stage !== 'pending')
  ) {
    return '关联生产工单已经开始执行，不能删除计划';
  }
  if (
    workOrder.processRoute?.startedAt
    || workOrder.processRoute?.completedAt
    || workOrder.processRoute?.status === 'in_progress'
    || workOrder.processRoute?.status === 'completed'
    || workOrder.processRoute?.steps.some(step => (
      step.startedAt
      || step.completedAt
      || step.status === 'current'
      || step.status === 'completed'
      || step.executionCount > 0
    ))
  ) {
    return '关联生产工单已有工序执行记录，不能删除计划';
  }
  return null;
}

export function productionPlanOrderDeletionDisposition(input: {
  orderQuantity: number;
  activeBatchQuantity: number;
  removedBatchQuantity: number;
}): ProductionPlanOrderDeletionDisposition {
  const orderQuantity = Math.max(0, Math.trunc(input.orderQuantity));
  const activeBatchQuantity = Math.max(0, Math.trunc(input.activeBatchQuantity));
  const removedBatchQuantity = Math.max(0, Math.trunc(input.removedBatchQuantity));
  const nextOrderQuantity = Math.max(activeBatchQuantity, orderQuantity - removedBatchQuantity);
  return {
    nextOrderQuantity,
    activeBatchQuantity,
    removedBatchQuantity,
    shouldDeleteOrder: nextOrderQuantity === 0 && activeBatchQuantity === 0,
  };
}

export async function previewProductionPlanBatchDeletion(
  tx: Prisma.TransactionClient,
  batchIds: string[],
): Promise<ProductionPlanBatchDeletionPreview> {
  const batches = await tx.productionPlanBatch.findMany({
    where: { id: { in: batchIds }, deletedAt: null, planOrder: { deletedAt: null } },
    include: {
      planOrder: { select: { specification: true } },
      workOrder: {
        select: {
          id: true,
          stage: true,
          status: true,
          progress: true,
          startedAt: true,
          completedAt: true,
          lastProgressAt: true,
          completedQty: true,
          frontendTransferredQty: true,
          _count: { select: { progressLogs: true } },
          processRoute: {
            select: {
              status: true,
              startedAt: true,
              completedAt: true,
              steps: {
                where: { retiredAt: null },
                select: {
                  status: true,
                  startedAt: true,
                  completedAt: true,
                  _count: { select: { executions: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (batches.length !== batchIds.length) throw new Error('PLAN_BATCH_SELECTION_INVALID');

  const items: ProductionPlanBatchDeletionPreview['items'] = batches.map(batch => {
    if (batch.releaseState === 'archived') {
      return {
        batchId: batch.id,
        specification: batch.planOrder.specification,
        quantity: batch.quantity,
        action: 'blocked' as const,
        message: '历史归档批次不能删除',
      };
    }
    if (!batch.workOrder) {
      if (batch.releaseState !== 'draft') {
        return {
          batchId: batch.id,
          specification: batch.planOrder.specification,
          quantity: batch.quantity,
          action: 'blocked' as const,
          message: '已下达批次缺少关联生产工单，请先检查数据',
        };
      }
      return {
        batchId: batch.id,
        specification: batch.planOrder.specification,
        quantity: batch.quantity,
        action: 'delete_draft' as const,
        message: '尚未下达，将从计划系统移除且不会回到订单池',
      };
    }

    const blocker = productionPlanWorkOrderStartBlocker({
      stage: batch.workOrder.stage,
      status: batch.workOrder.status,
      progress: batch.workOrder.progress,
      startedAt: batch.workOrder.startedAt,
      completedAt: batch.workOrder.completedAt,
      lastProgressAt: batch.workOrder.lastProgressAt,
      completedQty: batch.workOrder.completedQty,
      frontendTransferredQty: batch.workOrder.frontendTransferredQty,
      progressLogCount: batch.workOrder._count.progressLogs,
      processRoute: batch.workOrder.processRoute
        ? {
            status: batch.workOrder.processRoute.status,
            startedAt: batch.workOrder.processRoute.startedAt,
            completedAt: batch.workOrder.processRoute.completedAt,
            steps: batch.workOrder.processRoute.steps.map(step => ({
              status: step.status,
              startedAt: step.startedAt,
              completedAt: step.completedAt,
              executionCount: step._count.executions,
            })),
          }
        : null,
    });
    return {
      batchId: batch.id,
      specification: batch.planOrder.specification,
      quantity: batch.quantity,
      action: blocker ? 'blocked' as const : 'withdraw_unstarted' as const,
      message: blocker || '已下达但尚未开工，将撤回并软删除关联生产工单；删除数量不会回到订单池',
    };
  });

  return {
    batchCount: items.length,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    draftDeleteCount: items.filter(item => item.action === 'delete_draft').length,
    withdrawCount: items.filter(item => item.action === 'withdraw_unstarted').length,
    blockers: items.filter(item => item.action === 'blocked').length,
    items,
  };
}

export async function deleteProductionPlanBatches(
  tx: Prisma.TransactionClient,
  input: { batchIds: string[]; actorId: string },
): Promise<{
  draftDeletedCount: number;
  withdrawnCount: number;
  planOrderDeletedCount: number;
  removedOrderQuantity: number;
}> {
  const preview = await previewProductionPlanBatchDeletion(tx, input.batchIds);
  if (preview.blockers > 0) throw new Error('PLAN_BATCH_DELETE_BLOCKED');
  const batches = await tx.productionPlanBatch.findMany({
    where: { id: { in: input.batchIds }, deletedAt: null },
    select: { id: true, planOrderId: true, releaseState: true, workOrderId: true, quantity: true },
  });
  if (batches.length !== input.batchIds.length) throw new Error('PLAN_BATCH_SELECTION_INVALID');
  const affectedOrderIds = Array.from(new Set(batches.map(batch => batch.planOrderId)));
  const affectedOrders = await tx.productionPlanOrder.findMany({
    where: { id: { in: affectedOrderIds }, deletedAt: null },
    select: {
      id: true,
      orderQuantity: true,
      batches: {
        where: { deletedAt: null },
        select: { id: true, quantity: true },
      },
    },
  });
  if (affectedOrders.length !== affectedOrderIds.length) throw new Error('PLAN_BATCH_SELECTION_INVALID');

  const now = new Date();
  for (const batch of batches) {
    const item = preview.items.find(candidate => candidate.batchId === batch.id);
    if (!item || item.action === 'blocked') throw new Error('PLAN_BATCH_DELETE_BLOCKED');
    if (item.action === 'withdraw_unstarted' && batch.workOrderId) {
      await tx.workOrder.updateMany({
        where: { id: batch.workOrderId, deletedAt: null },
        data: {
          deletedAt: now,
          planActive: false,
          planClearedAt: now,
          planClearedBy: input.actorId,
        },
      });
    }
    await tx.productionPlanBatch.update({ where: { id: batch.id }, data: { deletedAt: now } });
    await tx.productionPlanChange.create({
      data: {
        planOrderId: batch.planOrderId,
        batchId: batch.id,
        action: item.action === 'delete_draft' ? 'delete_plan_batch' : 'withdraw_unstarted_plan_batch',
        beforeData: {
          releaseState: batch.releaseState,
          quantity: batch.quantity,
          workOrderId: batch.workOrderId,
        },
        afterData: { deletedAt: now.toISOString() },
        impactData: {
          workOrderSoftDeleted: item.action === 'withdraw_unstarted',
          returnedToOrderPool: false,
          retainedDrawingLibraryItem: true,
          retainedProductTimeProfiles: true,
          retainedStorageFiles: true,
          retainedPreparationHistory: true,
        },
        actorId: input.actorId,
      },
    });
    await tx.operationLog.create({
      data: {
        userId: input.actorId,
        action: item.action === 'delete_draft' ? 'delete_production_plan_batch' : 'withdraw_unstarted_production_plan_batch',
        targetType: 'production_plan_batch',
        targetId: batch.id,
        detail: {
          workOrderId: batch.workOrderId,
          returnedToOrderPool: false,
          retainedDrawingLibraryItem: true,
          retainedProductTimeProfiles: true,
          retainedStorageFiles: true,
        },
      },
    });
  }

  let planOrderDeletedCount = 0;
  let removedOrderQuantity = 0;
  const selectedBatchIds = new Set(input.batchIds);
  for (const order of affectedOrders) {
    const removedBatchQuantity = batches
      .filter(batch => batch.planOrderId === order.id)
      .reduce((sum, batch) => sum + batch.quantity, 0);
    const activeBatchQuantity = order.batches
      .filter(batch => !selectedBatchIds.has(batch.id))
      .reduce((sum, batch) => sum + batch.quantity, 0);
    const disposition = productionPlanOrderDeletionDisposition({
      orderQuantity: order.orderQuantity,
      activeBatchQuantity,
      removedBatchQuantity,
    });
    removedOrderQuantity += Math.max(0, order.orderQuantity - disposition.nextOrderQuantity);
    if (disposition.shouldDeleteOrder) {
      await tx.productionPlanOrder.update({
        where: { id: order.id },
        data: { deletedAt: now, updatedById: input.actorId },
      });
      planOrderDeletedCount += 1;
    } else if (disposition.nextOrderQuantity !== order.orderQuantity) {
      await tx.productionPlanOrder.update({
        where: { id: order.id },
        data: { orderQuantity: disposition.nextOrderQuantity, updatedById: input.actorId },
      });
      await refreshProductionPlanOrderStatus(tx, order.id);
    } else {
      await refreshProductionPlanOrderStatus(tx, order.id);
    }
    await tx.productionPlanChange.create({
      data: {
        planOrderId: order.id,
        action: disposition.shouldDeleteOrder
          ? 'delete_empty_plan_order_after_batch_deletion'
          : 'remove_deleted_plan_quantity',
        beforeData: { orderQuantity: order.orderQuantity },
        afterData: disposition.shouldDeleteOrder
          ? { deletedAt: now.toISOString() }
          : { orderQuantity: disposition.nextOrderQuantity },
        impactData: {
          removedBatchQuantity,
          activeBatchQuantity,
          returnedToOrderPool: false,
          retainedDrawingLibraryItem: true,
          retainedProductTimeProfiles: true,
        },
        actorId: input.actorId,
      },
    });
    await tx.operationLog.create({
      data: {
        userId: input.actorId,
        action: disposition.shouldDeleteOrder
          ? 'delete_empty_production_plan_order'
          : 'remove_deleted_production_plan_quantity',
        targetType: 'production_plan_order',
        targetId: order.id,
        detail: {
          previousOrderQuantity: order.orderQuantity,
          nextOrderQuantity: disposition.nextOrderQuantity,
          removedBatchQuantity,
          activeBatchQuantity,
          returnedToOrderPool: false,
          retainedDrawingLibraryItem: true,
          retainedProductTimeProfiles: true,
        },
      },
    });
  }
  return {
    draftDeletedCount: preview.draftDeleteCount,
    withdrawnCount: preview.withdrawCount,
    planOrderDeletedCount,
    removedOrderQuantity,
  };
}

export async function reconcileLegacyDeletedPlanQuantities(
  tx: Prisma.TransactionClient,
  input: { actorId: string; now?: Date },
): Promise<{ adjustedOrderCount: number; deletedOrderCount: number }> {
  const orders = await tx.productionPlanOrder.findMany({
    where: {
      deletedAt: null,
      batches: { some: { deletedAt: { not: null } } },
    },
    select: {
      id: true,
      orderQuantity: true,
      batches: { select: { quantity: true, deletedAt: true } },
    },
    take: 1000,
  });
  const now = input.now || new Date();
  let adjustedOrderCount = 0;
  let deletedOrderCount = 0;
  for (const order of orders) {
    const activeBatchQuantity = order.batches
      .filter(batch => !batch.deletedAt)
      .reduce((sum, batch) => sum + batch.quantity, 0);
    const deletedBatchQuantity = order.batches
      .filter(batch => Boolean(batch.deletedAt))
      .reduce((sum, batch) => sum + batch.quantity, 0);
    if (!deletedBatchQuantity || activeBatchQuantity >= order.orderQuantity) continue;
    if (activeBatchQuantity + deletedBatchQuantity < order.orderQuantity) continue;
    if (activeBatchQuantity === 0) {
      await tx.productionPlanOrder.update({
        where: { id: order.id },
        data: { deletedAt: now, updatedById: input.actorId },
      });
      deletedOrderCount += 1;
    } else {
      await tx.productionPlanOrder.update({
        where: { id: order.id },
        data: { orderQuantity: activeBatchQuantity, updatedById: input.actorId },
      });
      await refreshProductionPlanOrderStatus(tx, order.id);
      adjustedOrderCount += 1;
    }
    await tx.productionPlanChange.create({
      data: {
        planOrderId: order.id,
        action: activeBatchQuantity === 0
          ? 'reconcile_deleted_plan_order'
          : 'reconcile_deleted_plan_quantity',
        beforeData: { orderQuantity: order.orderQuantity },
        afterData: activeBatchQuantity === 0
          ? { deletedAt: now.toISOString() }
          : { orderQuantity: activeBatchQuantity },
        impactData: {
          deletedBatchQuantity,
          activeBatchQuantity,
          returnedToOrderPool: false,
          retainedDrawingLibraryItem: true,
          retainedProductTimeProfiles: true,
        },
        reason: '兼容历史删除记录：删除计划数量不再回到订单池',
        actorId: input.actorId,
      },
    });
  }
  if (adjustedOrderCount || deletedOrderCount) {
    await tx.operationLog.create({
      data: {
        userId: input.actorId,
        action: 'reconcile_deleted_production_plan_quantities',
        targetType: 'production_plan_order',
        targetId: 'legacy-deleted-plan-quantities',
        detail: {
          adjustedOrderCount,
          deletedOrderCount,
          retainedDrawingLibraryItems: true,
          retainedProductTimeProfiles: true,
        },
      },
    });
  }
  return { adjustedOrderCount, deletedOrderCount };
}

type PlanningResourceFile = {
  id: string;
  version: string;
  updatedAt: Date;
  category: { code: string };
};

type PlanningSopDocument = {
  sopStage: string;
  drawingStatus: string;
  remark: string | null;
  deletedAt: Date | null;
  updatedAt: Date;
};

function planningResourceSummary(item: {
  files: PlanningResourceFile[];
  sopDocument?: PlanningSopDocument | null;
} | null | undefined) {
  const files = item?.files || [];
  const drawings = files.filter(file => file.category.code === 'drawing');
  const sops = files.filter(file => file.category.code === 'sop');
  const sopDocument = item?.sopDocument && !item.sopDocument.deletedAt ? item.sopDocument : null;
  return {
    drawingFileCount: drawings.length,
    sopFileCount: sops.length,
    drawing: drawings[0] || null,
    sop: sops[0] || null,
    sopStage: normalizePlanningSopStage(sopDocument?.sopStage),
    sopDrawingStatus: normalizePlanningSopDrawingStatus(sopDocument?.drawingStatus),
    sopRemark: sopDocument?.remark || null,
    sopMetadataUpdatedAt: sopDocument?.updatedAt.toISOString() || null,
  };
}

function printSnapshotTargetQty(value: Prisma.JsonValue): number | null {
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;
  const quantity = (value as Prisma.JsonObject).targetQty;
  return typeof quantity === 'number' && Number.isFinite(quantity) ? quantity : null;
}

function batchTravelerPrint(
  batch: ProductionPlanOrderRecord['batches'][number],
  resources: ReturnType<typeof planningResourceSummary>,
): Pick<ProductionPlanBatchDTO,
  'travelerPrintStatus' | 'travelerPrintMode' | 'travelerPrintMaterials' | 'travelerPrintId' | 'travelerPrintGeneratedAt' | 'travelerPrintConfirmedAt'> {
  const latest = batch.workOrder?.qrTicket?.prints[0] || null;
  if (!latest) {
    return {
      travelerPrintStatus: 'not_printed',
      travelerPrintMode: null,
      travelerPrintMaterials: null,
      travelerPrintId: null,
      travelerPrintGeneratedAt: null,
      travelerPrintConfirmedAt: null,
    };
  }
  const route = batch.workOrder?.processRoute;
  const travelerStale = latest.routeVersion !== route?.version || printSnapshotTargetQty(latest.snapshot) !== batch.quantity;
  const materialStates: NonNullable<ProductionPlanBatchDTO['travelerPrintMaterials']> = {};
  for (const item of latest.items) {
    const stale = item.material === 'TRAVELER'
      ? travelerStale
      : item.material === 'SOP'
        ? item.fileId !== resources.sop?.id || item.fileVersion !== resources.sop?.version
        : item.fileId !== resources.drawing?.id || item.fileVersion !== resources.drawing?.version;
    materialStates[item.material] = {
      status: stale
        ? 'needs_reprint'
        : item.status === 'CONFIRMED'
          ? 'printed'
          : item.status === 'LEGACY_UNVERIFIED'
            ? 'legacy_unverified'
            : 'generated',
      copies: item.copies,
      confirmedAt: item.confirmedAt?.toISOString() || null,
    };
  }
  const states = Object.values(materialStates);
  const stale = states.some(item => item.status === 'needs_reprint');
  const confirmedCount = states.filter(item => item.status === 'printed').length;
  const status: ProductionPlanBatchDTO['travelerPrintStatus'] = stale
    ? 'needs_reprint'
    : states.length > 0 && confirmedCount === states.length
      ? 'printed'
      : confirmedCount > 0
        ? 'partial'
        : states.length > 0 && states.every(item => item.status === 'legacy_unverified')
        ? 'legacy_unverified'
        : 'generated';
  return {
    travelerPrintStatus: status,
    travelerPrintMode: latest.mode,
    travelerPrintMaterials: materialStates,
    travelerPrintId: latest.id,
    travelerPrintGeneratedAt: latest.printedAt.toISOString(),
    travelerPrintConfirmedAt: latest.confirmedAt?.toISOString() || null,
  };
}

function batchDto(
  batch: ProductionPlanOrderRecord['batches'][number],
  resources: ReturnType<typeof planningResourceSummary>,
): ProductionPlanBatchDTO {
  const state = batch.releaseState as ProductionPlanReleaseState;
  const route = batch.workOrder?.processRoute;
  const currentStep = route?.steps.find(step => step.status === 'current')
    || route?.steps.find(step => step.status === 'pending')
    || [...(route?.steps || [])].reverse().find(step => step.status === 'completed')
    || null;
  const print = batchTravelerPrint(batch, resources);
  return {
    id: batch.id,
    planOrderId: batch.planOrderId,
    batchNo: batch.batchNo,
    quantity: batch.quantity,
    weekStartDate: chinaDate(batch.weekStartDate),
    weekEndDate: chinaDate(batch.weekEndDate),
    plannedCompletionDate: chinaDate(batch.plannedCompletionDate),
    releaseState: state,
    workOrderId: batch.workOrderId,
    productTimeProfileId: batch.productTimeProfileId,
    productTimeProfileVersion: batch.productTimeProfileVersion,
    unitMillisecondsSnapshot: batch.unitMillisecondsSnapshot,
    totalMillisecondsSnapshot: batch.totalMillisecondsSnapshot?.toString() || null,
    warehouseStatus: (batch.workOrder?.materialTask?.status as ProductionPlanBatchDTO['warehouseStatus']) || 'not_created',
    processStatus: (route?.status as ProductionPlanBatchDTO['processStatus']) || 'not_created',
    warehouseCompletedAt: batch.workOrder?.materialTask?.completedAt?.toISOString() || null,
    processConfirmedAt: route?.confirmedAt?.toISOString() || null,
    processStartedAt: route?.startedAt?.toISOString() || null,
    processCompletedAt: route?.completedAt?.toISOString() || null,
    workOrderStartedAt: batch.workOrder?.startedAt?.toISOString() || null,
    workOrderCompletedAt: batch.workOrder?.completedAt?.toISOString() || null,
    currentProcessName: currentStep?.processName || null,
    currentProcessStartedAt: currentStep?.startedAt?.toISOString() || null,
    ...print,
    releasedAt: batch.releasedAt?.toISOString() || null,
    activatedAt: batch.activatedAt?.toISOString() || null,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
  };
}

export function serializeProductionPlanOrder(order: ProductionPlanOrderRecord): ProductionPlanOrderDTO {
  const allocatedQuantity = order.batches.reduce((sum, batch) => sum + batch.quantity, 0);
  const activeDrawingLibraryItem = order.drawingLibraryItem?.deletedAt ? null : order.drawingLibraryItem;
  const resources = planningResourceSummary(activeDrawingLibraryItem);
  const profile = activeDrawingLibraryItem?.productTimeProfiles[0] || null;
  const currentUnitMilliseconds = profile ? productTimeTotalMilliseconds(profile.entries) : null;
  const effectiveUnitMilliseconds = currentUnitMilliseconds || order.planningUnitMilliseconds;
  return {
    id: order.id,
    sourceOrderNo: order.sourceOrderNo,
    sourceLineNo: order.sourceLineNo,
    customerName: order.customerName,
    salesperson: order.salesperson,
    productName: order.productName,
    specification: order.specification,
    drawingLibraryItemId: order.drawingLibraryItemId,
    drawingFileCount: resources.drawingFileCount,
    sopFileCount: resources.sopFileCount,
    sopStage: resources.sopStage,
    sopDrawingStatus: resources.sopDrawingStatus,
    sopRemark: resources.sopRemark,
    sopMetadataUpdatedAt: resources.sopMetadataUpdatedAt,
    orderQuantity: order.orderQuantity,
    planningUnitMilliseconds: order.planningUnitMilliseconds,
    effectiveUnitMilliseconds,
    planningTotalMilliseconds: effectiveUnitMilliseconds
      ? (BigInt(effectiveUnitMilliseconds) * BigInt(order.orderQuantity)).toString()
      : null,
    allocatedQuantity,
    remainingQuantity: Math.max(0, order.orderQuantity - allocatedQuantity),
    orderDate: chinaDate(order.orderDate),
    customerDueDate: chinaDate(order.customerDueDate),
    priority: order.priority as ProductionPlanPriority,
    status: order.status as ProductionPlanOrderStatus,
    remark: order.remark,
    currentUnitMilliseconds,
    currentProductTimeVersion: profile?.version || null,
    batches: order.batches.map(batch => batchDto(batch, resources)),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

function flatJson(value: Prisma.JsonValue | null): Record<string, string | number | boolean | null> | null {
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') result[key] = item;
  }
  return result;
}

export function serializeProductionPlanChange(change: ProductionPlanChangeRecord): ProductionPlanChangeDTO {
  return {
    id: change.id,
    planOrderId: change.planOrderId,
    batchId: change.batchId,
    action: change.action,
    reason: change.reason,
    beforeData: flatJson(change.beforeData),
    afterData: flatJson(change.afterData),
    impactData: flatJson(change.impactData),
    actor: change.actor,
    createdAt: change.createdAt.toISOString(),
  };
}

export async function refreshProductionPlanOrderStatus(
  tx: Prisma.TransactionClient,
  planOrderId: string,
): Promise<ProductionPlanOrderStatus> {
  const order = await tx.productionPlanOrder.findUnique({
    where: { id: planOrderId },
    select: {
      orderQuantity: true,
      status: true,
      batches: { where: { deletedAt: null }, select: { quantity: true, releaseState: true } },
    },
  });
  if (!order) throw new Error('PLAN_ORDER_NOT_FOUND');
  if (order.status === 'cancelled' || order.status === 'completed' || order.status === 'paused') return order.status as ProductionPlanOrderStatus;
  const allocated = order.batches.reduce((sum, batch) => sum + batch.quantity, 0);
  const released = order.batches.filter(batch => batch.releaseState !== 'draft').reduce((sum, batch) => sum + batch.quantity, 0);
  let status: ProductionPlanOrderStatus = 'pending';
  if (allocated > 0) status = released > 0 ? (released >= order.orderQuantity ? 'released' : 'partially_released') : 'scheduled';
  await tx.productionPlanOrder.update({ where: { id: planOrderId }, data: { status } });
  return status;
}

export function planOrderSnapshot(order: ParsedPlanOrder): Prisma.InputJsonObject {
  return {
    drawingLibraryItemId: order.drawingLibraryItemId,
    sourceOrderNo: order.sourceOrderNo,
    sourceLineNo: order.sourceLineNo,
    customerName: order.customerName,
    salesperson: order.salesperson,
    productName: order.productName,
    specification: order.specification,
    orderQuantity: order.orderQuantity,
    planningUnitMilliseconds: order.planningUnitMilliseconds,
    orderDate: chinaDate(order.orderDate),
    customerDueDate: chinaDate(order.customerDueDate),
    priority: order.priority,
    status: order.status,
    remark: order.remark,
  };
}

export function planBatchSnapshot(batch: ParsedPlanBatch & { batchNo?: number; releaseState?: string }): Prisma.InputJsonObject {
  return {
    batchNo: batch.batchNo || null,
    quantity: batch.quantity,
    weekStartDate: chinaDate(batch.weekStartDate),
    weekEndDate: chinaDate(batch.weekEndDate),
    plannedCompletionDate: chinaDate(batch.plannedCompletionDate),
    unitMilliseconds: batch.unitMilliseconds,
    releaseState: batch.releaseState || 'draft',
  };
}

function workOrderCode(sourceOrderNo: string, sourceLineNo: number, batchNo: number): string {
  const safe = sourceOrderNo.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'ORDER';
  return `PLN-${safe}-${sourceLineNo}-${batchNo}`.slice(0, 80);
}

function workHours(milliseconds: number | null): string | null {
  return milliseconds ? (milliseconds / 3_600_000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : null;
}

async function startReadyScheduledWorkOrder(
  tx: Prisma.TransactionClient,
  input: {
    workOrderId: string;
    actorId: string;
    now: Date;
    trigger: 'automatic_plan_release' | 'automatic_plan_reconciliation';
  },
): Promise<boolean> {
  const route = await tx.workOrderProcessRoute.findUnique({
    where: { workOrderId: input.workOrderId },
    select: {
      status: true,
      startedAt: true,
      workOrder: {
        select: {
          stage: true,
          status: true,
          startedAt: true,
          completedAt: true,
          drawingLibraryItem: {
            select: {
              files: {
                where: { deletedAt: null, isCurrent: true, category: { code: { in: ['drawing', 'sop'] } } },
                select: { category: { select: { code: true } } },
              },
            },
          },
        },
      },
      steps: {
        where: { retiredAt: null },
        orderBy: { position: 'asc' },
        select: {
          processName: true,
          status: true,
          timeBasis: true,
          unitLabel: true,
          standardMillisecondsPerUnit: true,
          setupMilliseconds: true,
          unitsPerProduct: true,
        },
      },
    },
  });
  const stage = normalizeWorkOrderStage(route?.workOrder.stage || route?.workOrder.status) || 'not_issued';
  const resourceCodes = new Set(route?.workOrder.drawingLibraryItem?.files.map(file => file.category.code) || []);
  if (
    !route
    || route.status !== 'confirmed'
    || route.startedAt
    || stage !== 'not_issued'
    || route.workOrder.startedAt
    || route.workOrder.completedAt
    || !resourceCodes.has('drawing')
    || !resourceCodes.has('sop')
    || !processRouteExecutionReadiness(route.steps).ready
  ) return false;
  return startConfirmedProcessRoute(tx, {
    workOrderId: input.workOrderId,
    userId: input.actorId,
    actor: '系统自动调度',
    now: input.now,
    trigger: input.trigger,
  });
}

export async function releaseProductionPlanBatch(
  tx: Prisma.TransactionClient,
  input: {
    batchId: string;
    target: 'preparation' | 'active';
    actorId: string;
    now?: Date;
    trigger?: 'manual' | 'automatic_schedule' | 'automatic_reconciliation';
  },
): Promise<{ workOrderId: string; warnings: string[]; created: boolean; started: boolean }> {
  const batch = await tx.productionPlanBatch.findUnique({
    where: { id: input.batchId },
    include: {
      planOrder: true,
      workOrder: { select: { id: true, drawingStatus: true, drawingIssuedAt: true } },
    },
  });
  if (!batch || batch.deletedAt || batch.planOrder.deletedAt) throw new Error('PLAN_BATCH_NOT_FOUND');
  if (batch.releaseState === 'archived') throw new Error('PLAN_BATCH_ARCHIVED');
  if (productionPlanReleaseTransitionBlocker(batch.releaseState, input.target)) {
    throw new Error('PLAN_ACTIVE_BATCH_CANNOT_MOVE_TO_PREPARATION');
  }
  const now = input.now || new Date();
  const alignedWeek = alignProductionPlanBatchWeek(batch, input.target, now);
  const references = await resolvePlanningReferences(tx, batch.planOrder);
  const effectiveUnitMilliseconds = effectivePlanningUnitMilliseconds(
    batch.unitMillisecondsSnapshot,
    references.unitMilliseconds,
    batch.planOrder.planningUnitMilliseconds,
  );
  const totalMilliseconds = effectiveUnitMilliseconds ? BigInt(effectiveUnitMilliseconds) * BigInt(batch.quantity) : null;
  const productTimePending = !references.productTimeProfileId || !effectiveUnitMilliseconds;
  const warnings: string[] = [];
  if (!references.drawingLibraryItemId) {
    warnings.push('产品资料档案待匹配：仓库可先配料，生产启动前必须补齐原图和 SOP');
  } else {
    if (!references.drawingFileCount) warnings.push('原图待上传：仓库可先配料，生产启动前必须补齐');
    if (!references.sopFileCount) warnings.push('SOP作业指导书待上传：仓库可先配料，生产启动前必须补齐');
  }
  if (!references.productTimeProfileId) {
    warnings.push('产品工序与工时待补充：仓库可先配料，生产启动前必须发布');
  } else if (!effectiveUnitMilliseconds) {
    warnings.push('产品工时待修正：仓库可先配料，生产启动前必须补齐有效总工时');
  }
  if (planningSopRequiresReleaseConfirmation(references.sopStage)) {
    warnings.push(`SOP处于验证中：${references.sopRemark || '需按验证条件执行并保留确认记录'}`);
  }
  const code = workOrderCode(batch.planOrder.sourceOrderNo, batch.planOrder.sourceLineNo, batch.batchNo);
  const planActive = input.target === 'active';
  const hasOriginalDrawing = references.drawingFileCount > 0;
  const data = {
    code,
    customerName: batch.planOrder.customerName,
    salesperson: batch.planOrder.salesperson,
    productName: batch.planOrder.productName,
    stage: 'not_issued',
    priority: batch.planOrder.priority === 'insert' ? 'urgent' : batch.planOrder.priority,
    status: 'pending',
    progress: 0,
    plannedAt: alignedWeek.plannedCompletionDate,
    remark: batch.planOrder.remark,
    sourceOrderNo: batch.planOrder.sourceOrderNo,
    orderDate: batch.planOrder.orderDate,
    specification: batch.planOrder.specification,
    uncompletedQty: String(batch.quantity),
    productionTargetQty: batch.quantity,
    unitWorkHours: workHours(effectiveUnitMilliseconds),
    totalWorkHours: workHours(totalMilliseconds ? Number(totalMilliseconds) : null),
    deliveryDay: chinaDate(batch.planOrder.customerDueDate),
    materialStatus: '待配料',
    planType: 'managed_plan',
    weekStartDate: alignedWeek.weekStartDate,
    weekEndDate: alignedWeek.weekEndDate,
    planActive,
    planClearedAt: null,
    planClearedBy: null,
    libraryKey: batch.planOrder.specification,
    drawingLibraryItemId: references.drawingLibraryItemId,
    drawingStatus: hasOriginalDrawing ? '已发' : null,
    drawingIssuedAt: hasOriginalDrawing ? now : null,
  } satisfies Prisma.WorkOrderUncheckedCreateInput;
  const created = !batch.workOrderId;
  const businessCode = created
    ? await allocateBusinessWorkOrderCode(tx, {
        specification: data.specification,
        productName: data.productName,
        plannedAt: data.plannedAt,
        orderDate: data.orderDate,
        createdAt: now,
      })
    : null;
  const workOrder = batch.workOrderId
    ? await tx.workOrder.update({
        where: { id: batch.workOrderId },
        data: {
          customerName: data.customerName,
          salesperson: data.salesperson,
          productName: data.productName,
          priority: data.priority,
          plannedAt: data.plannedAt,
          remark: data.remark,
          specification: data.specification,
          uncompletedQty: data.uncompletedQty,
          productionTargetQty: data.productionTargetQty,
          unitWorkHours: data.unitWorkHours,
          totalWorkHours: data.totalWorkHours,
          deliveryDay: data.deliveryDay,
          weekStartDate: data.weekStartDate,
          weekEndDate: data.weekEndDate,
          planActive,
          planClearedAt: null,
          planClearedBy: null,
          drawingLibraryItemId: data.drawingLibraryItemId,
          ...(hasOriginalDrawing && shouldSynchronizeDrawingReleaseStatus(batch.workOrder?.drawingStatus)
            ? {
                drawingStatus: '已发',
                drawingIssuedAt: batch.workOrder?.drawingIssuedAt || now,
              }
            : {}),
        },
        select: { id: true },
      })
    : await tx.workOrder.create({ data: { ...data, businessCode }, select: { id: true } });

  await tx.warehouseMaterialTask.upsert({
    where: { workOrderId: workOrder.id },
    create: { workOrderId: workOrder.id, status: 'pending', updatedById: input.actorId },
    update: {},
  });

  await createWorkOrderProcessRoute(tx, { workOrderId: workOrder.id, actorId: input.actorId });
  const started = await startReadyScheduledWorkOrder(tx, {
    workOrderId: workOrder.id,
    actorId: input.actorId,
    now,
    trigger: input.trigger === 'automatic_reconciliation'
      ? 'automatic_plan_reconciliation'
      : 'automatic_plan_release',
  });

  await tx.productionPlanBatch.update({
    where: { id: batch.id },
    data: {
      workOrderId: workOrder.id,
      releaseState: input.target,
      weekStartDate: alignedWeek.weekStartDate,
      weekEndDate: alignedWeek.weekEndDate,
      plannedCompletionDate: alignedWeek.plannedCompletionDate,
      productTimeProfileId: references.productTimeProfileId,
      productTimeProfileVersion: references.productTimeProfileVersion,
      unitMillisecondsSnapshot: effectiveUnitMilliseconds,
      totalMillisecondsSnapshot: totalMilliseconds,
      releasedAt: batch.releasedAt || now,
      releasedById: batch.releasedById || input.actorId,
      activatedAt: planActive ? now : batch.activatedAt,
      activatedById: planActive ? input.actorId : batch.activatedById,
    },
  });
  await refreshProductionPlanOrderStatus(tx, batch.planOrderId);
  await tx.productionPlanChange.create({
    data: {
      planOrderId: batch.planOrderId,
      batchId: batch.id,
      action: input.target === 'active' ? 'release_to_current_week' : 'release_to_next_week',
      beforeData: {
        releaseState: batch.releaseState,
        weekStartDate: chinaDate(batch.weekStartDate),
        weekEndDate: chinaDate(batch.weekEndDate),
        plannedCompletionDate: chinaDate(batch.plannedCompletionDate),
      },
      afterData: {
        workOrderId: workOrder.id,
        releaseState: input.target,
        planActive,
        weekStartDate: chinaDate(alignedWeek.weekStartDate),
        weekEndDate: chinaDate(alignedWeek.weekEndDate),
        plannedCompletionDate: chinaDate(alignedWeek.plannedCompletionDate),
      },
      impactData: {
        warehouseTaskCreated: true,
        productTimePending,
        sopStage: references.sopStage,
        sopValidationRequired: planningSopRequiresReleaseConfirmation(references.sopStage),
        processWarnings: warnings.length,
        automaticallyStarted: started,
        weekRealigned: chinaDate(batch.weekStartDate) !== chinaDate(alignedWeek.weekStartDate),
        trigger: input.trigger || 'manual',
      },
      reason: input.trigger === 'automatic_schedule'
        ? '排入本周或下周后自动进入生产执行'
        : input.trigger === 'automatic_reconciliation'
          ? '自动纠正生产周与下达状态不一致'
          : null,
      actorId: input.actorId,
    },
  });
  await tx.operationLog.create({
    data: {
      userId: input.actorId,
      action: input.target === 'active' ? 'release_plan_to_current_week' : 'release_plan_to_next_week',
      targetType: 'production_plan_batch',
      targetId: batch.id,
      detail: {
        workOrderId: workOrder.id,
        warehouseTaskCreated: true,
        productTimePending,
        sopStage: references.sopStage,
        sopValidationRequired: planningSopRequiresReleaseConfirmation(references.sopStage),
        warnings: warnings.length,
        automaticallyStarted: started,
        trigger: input.trigger || 'manual',
      },
    },
  });
  return { workOrderId: workOrder.id, warnings, created, started };
}

export async function automaticallyReleaseProductionPlanBatch(
  tx: Prisma.TransactionClient,
  input: {
    batchId: string;
    actorId: string;
    now?: Date;
    trigger?: 'automatic_schedule' | 'automatic_reconciliation';
    confirmSopValidation?: boolean;
  },
): Promise<({ target: AutomaticProductionPlanReleaseTarget } & Awaited<ReturnType<typeof releaseProductionPlanBatch>>) | null> {
  const batch = await tx.productionPlanBatch.findUnique({
    where: { id: input.batchId },
    select: {
      id: true,
      weekStartDate: true,
      releaseState: true,
      workOrderId: true,
      deletedAt: true,
      planOrder: { select: { deletedAt: true } },
    },
  });
  if (!batch || batch.deletedAt || batch.planOrder.deletedAt) return null;
  const target = automaticProductionPlanReleaseTarget(batch, input.now);
  if (!target) return null;
  const preview = await previewProductionPlanRelease(tx, {
    batchIds: [batch.id],
    target,
    now: input.now,
  });
  if (preview.blockers > 0) return null;
  if (preview.validatingSopCount > 0 && !input.confirmSopValidation) return null;
  const released = await releaseProductionPlanBatch(tx, {
    batchId: batch.id,
    target,
    actorId: input.actorId,
    now: input.now,
    trigger: input.trigger || 'automatic_schedule',
  });
  return { target, ...released };
}

export async function reconcileAutomaticallyReleasedProductionPlanBatches(
  tx: Prisma.TransactionClient,
  input: { actorId: string; now?: Date },
): Promise<{ active: number; preparation: number; warningCount: number; started: number }> {
  const now = input.now || new Date();
  const currentWeek = productionPlanTargetWeek('active', now);
  const nextWeek = productionPlanTargetWeek('preparation', now);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'production-plan-auto-release'}))`;
  const batches = await tx.productionPlanBatch.findMany({
    where: {
      deletedAt: null,
      planOrder: { deletedAt: null },
      releaseState: { in: ['draft', 'preparation', 'active'] },
      weekStartDate: {
        gte: addPlanningDays(currentWeek.start, -1),
        lt: addPlanningDays(nextWeek.start, 2),
      },
    },
    select: {
      id: true,
      weekStartDate: true,
      releaseState: true,
      workOrderId: true,
      workOrder: {
        select: {
          id: true,
          stage: true,
          status: true,
          startedAt: true,
          completedAt: true,
        },
      },
    },
    orderBy: [{ weekStartDate: 'asc' }, { createdAt: 'asc' }],
    take: 5000,
  });
  const result = { active: 0, preparation: 0, warningCount: 0, started: 0 };
  for (const batch of batches) {
    const target = automaticProductionPlanReleaseTarget(batch, now);
    if (target) {
      const preview = await previewProductionPlanRelease(tx, {
        batchIds: [batch.id],
        target,
        now,
      });
      if (preview.blockers > 0) continue;
      const released = await releaseProductionPlanBatch(tx, {
        batchId: batch.id,
        target,
        actorId: input.actorId,
        now,
        trigger: 'automatic_reconciliation',
      });
      result[target] += 1;
      result.warningCount += released.warnings.length;
      if (released.started) result.started += 1;
      continue;
    }
    const workOrderStage = normalizeWorkOrderStage(batch.workOrder?.stage || batch.workOrder?.status) || 'not_issued';
    if (
      !batch.workOrderId
      || !batch.workOrder
      || workOrderStage !== 'not_issued'
      || batch.workOrder.startedAt
      || batch.workOrder.completedAt
    ) continue;
    await createWorkOrderProcessRoute(tx, { workOrderId: batch.workOrderId, actorId: input.actorId });
    if (await startReadyScheduledWorkOrder(tx, {
      workOrderId: batch.workOrderId,
      actorId: input.actorId,
      now,
      trigger: 'automatic_plan_reconciliation',
    })) result.started += 1;
  }
  return result;
}

export async function reconcileFutureActiveProductionPlanWeeks(
  tx: Prisma.TransactionClient,
  input: { actorId: string; now?: Date },
): Promise<number> {
  const now = input.now || new Date();
  const targetWeek = productionPlanTargetWeek('active', now);
  const batches = await tx.productionPlanBatch.findMany({
    where: {
      deletedAt: null,
      releaseState: 'active',
      weekStartDate: { gt: targetWeek.start },
    },
    select: {
      id: true,
      planOrderId: true,
      workOrderId: true,
      weekStartDate: true,
      weekEndDate: true,
      plannedCompletionDate: true,
    },
  });
  let repaired = 0;
  for (const batch of batches) {
    const alignedWeek = alignProductionPlanBatchWeek(batch, 'active', now);
    const updated = await tx.productionPlanBatch.updateMany({
      where: {
        id: batch.id,
        deletedAt: null,
        releaseState: 'active',
        weekStartDate: { gt: targetWeek.start },
      },
      data: {
        weekStartDate: alignedWeek.weekStartDate,
        weekEndDate: alignedWeek.weekEndDate,
        plannedCompletionDate: alignedWeek.plannedCompletionDate,
      },
    });
    if (!updated.count) continue;
    repaired += 1;
    if (batch.workOrderId) {
      await tx.workOrder.update({
        where: { id: batch.workOrderId },
        data: {
          weekStartDate: alignedWeek.weekStartDate,
          weekEndDate: alignedWeek.weekEndDate,
          plannedAt: alignedWeek.plannedCompletionDate,
          planActive: true,
          planClearedAt: null,
          planClearedBy: null,
        },
      });
    }
    await tx.productionPlanChange.create({
      data: {
        planOrderId: batch.planOrderId,
        batchId: batch.id,
        action: 'repair_active_plan_week_alignment',
        beforeData: {
          releaseState: 'active',
          weekStartDate: chinaDate(batch.weekStartDate),
          weekEndDate: chinaDate(batch.weekEndDate),
          plannedCompletionDate: chinaDate(batch.plannedCompletionDate),
        },
        afterData: {
          releaseState: 'active',
          weekStartDate: chinaDate(alignedWeek.weekStartDate),
          weekEndDate: chinaDate(alignedWeek.weekEndDate),
          plannedCompletionDate: chinaDate(alignedWeek.plannedCompletionDate),
        },
        impactData: { linkedWorkOrderUpdated: Boolean(batch.workOrderId) },
        reason: '修复本周执行状态与未来生产周日期不一致',
        actorId: input.actorId,
      },
    });
  }
  if (repaired) {
    await tx.operationLog.create({
      data: {
        userId: input.actorId,
        action: 'repair_active_plan_week_alignment',
        targetType: 'production_plan_week',
        targetId: chinaDate(targetWeek.start),
        detail: { repairedBatchCount: repaired },
      },
    });
  }
  return repaired;
}
