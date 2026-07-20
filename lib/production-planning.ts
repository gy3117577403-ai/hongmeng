import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { drawingLibraryKey } from '@/lib/drawing-library';
import { createWorkOrderProcessRoute } from '@/lib/process-routing';
import { productTimeTotalMilliseconds } from '@/lib/product-time';
import type {
  ProductionPlanBatchDTO,
  ProductionPlanChangeDTO,
  ProductionPlanOrderDTO,
  ProductionPlanOrderStatus,
  ProductionPlanPriority,
  ProductionPlanReleaseState,
} from '@/types';

export const productionPlanOrderInclude = {
  drawingLibraryItem: {
    select: {
      id: true,
      _count: { select: { files: { where: { deletedAt: null } } } },
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
    },
  },
  batches: {
    where: { deletedAt: null },
    orderBy: [{ weekStartDate: 'asc' as const }, { batchNo: 'asc' as const }],
    include: {
      workOrder: {
        select: {
          id: true,
          materialTask: { select: { status: true } },
          processRoute: { select: { status: true } },
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
};

export type ProductionPlanReleasePreview = {
  target: 'preparation' | 'active';
  batchCount: number;
  totalQuantity: number;
  warnings: number;
  blockers: number;
  items: Array<{
    batchId: string;
    specification: string;
    quantity: number;
    warnings: string[];
    blockers: string[];
  }>;
};

function text(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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
  const orderDate = input.orderDate === undefined && current ? current.orderDate : parsePlanDate(input.orderDate);
  const customerDueDate = input.customerDueDate === undefined && current ? current.customerDueDate : parsePlanDate(input.customerDueDate);
  const priority = input.priority === undefined && current ? current.priority : planPriority(input.priority);
  const status = input.status === undefined && current ? current.status : planOrderStatus(input.status);
  const remark = input.remark === undefined && current ? current.remark : text(input.remark, 500) || null;

  if (!customerName) return { ok: false, error: '请填写客户名称' };
  if (!productName) return { ok: false, error: '请填写产品名称' };
  if (!specification) return { ok: false, error: '请填写产品规格' };
  if (!orderQuantity) return { ok: false, error: '订单数量必须是正整数' };
  if (!orderDate) return { ok: false, error: '下单日期格式不正确' };
  if (!customerDueDate) return { ok: false, error: '客户交期格式不正确' };
  if (customerDueDate < orderDate) return { ok: false, error: '客户交期不能早于下单日期' };
  return {
    ok: true,
    data: { drawingLibraryItemId, sourceOrderNo, sourceLineNo, customerName, salesperson, productName, specification, orderQuantity, orderDate, customerDueDate, priority, status, remark },
  };
}

export function parseProductionPlanBatchInput(
  input: ProductionPlanBatchInput,
  current?: ParsedPlanBatch,
): { ok: true; data: ParsedPlanBatch } | { ok: false; error: string } {
  const quantity = input.quantity === undefined && current ? current.quantity : positiveInteger(input.quantity);
  const weekInput = input.weekStartDate === undefined && current ? current.weekStartDate : parsePlanDate(input.weekStartDate);
  const plannedCompletionDate = input.plannedCompletionDate === undefined && current
    ? current.plannedCompletionDate
    : parsePlanDate(input.plannedCompletionDate);
  if (!quantity) return { ok: false, error: '排产数量必须是正整数' };
  if (!weekInput) return { ok: false, error: '请选择排产周' };
  if (!plannedCompletionDate) return { ok: false, error: '请选择内部计划完成日期' };
  const range = chinaWeekRange(weekInput);
  if (plannedCompletionDate < range.start || plannedCompletionDate > range.end) {
    return { ok: false, error: '内部计划完成日期必须位于所选生产周内' };
  }
  return { ok: true, data: { quantity, weekStartDate: range.start, weekEndDate: range.end, plannedCompletionDate } };
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
      productTimeProfiles: {
        where: { status: 'published' },
        orderBy: { version: 'desc' },
        take: 1,
        select: { id: true, version: true, entries: { select: { unitMilliseconds: true } } },
      },
    },
  });
  const profile = drawing?.productTimeProfiles[0] || null;
  return {
    drawingLibraryItemId: drawing?.id || null,
    customerName: drawing?.customerName || null,
    productName: drawing?.productName || drawing?.specification || null,
    specification: drawing?.specification || null,
    productTimeProfileId: profile?.id || null,
    productTimeProfileVersion: profile?.version || null,
    unitMilliseconds: profile ? productTimeTotalMilliseconds(profile.entries) : null,
  };
}

export async function previewProductionPlanRelease(
  tx: Prisma.TransactionClient,
  input: { batchIds: string[]; target: 'preparation' | 'active' },
): Promise<ProductionPlanReleasePreview> {
  const [batches, defaultTemplate] = await Promise.all([
    tx.productionPlanBatch.findMany({
      where: { id: { in: input.batchIds }, deletedAt: null, planOrder: { deletedAt: null } },
      include: { planOrder: true },
    }),
    tx.processTemplate.findFirst({
      where: { isDefault: true, isActive: true },
      select: { id: true, _count: { select: { steps: true } } },
    }),
  ]);
  if (batches.length !== input.batchIds.length) throw new Error('PLAN_BATCH_SELECTION_INVALID');

  const items: ProductionPlanReleasePreview['items'] = [];
  for (const batch of batches) {
    const refs = await resolvePlanningReferences(tx, batch.planOrder);
    const warnings: string[] = [];
    const blockers: string[] = [];
    if (batch.releaseState === 'archived') blockers.push('该批次已经归档');
    if (batch.releaseState !== 'draft' && batch.releaseState !== input.target) {
      warnings.push(`当前已处于${batch.releaseState === 'active' ? '本周执行' : '下周预备'}状态`);
    }
    if (!refs.drawingLibraryItemId) warnings.push('未匹配图纸资料');
    if (!refs.productTimeProfileId) {
      if (input.target === 'active') blockers.push('产品工时尚未发布，不能正式启用生产');
      else warnings.push('产品工时尚未发布，可先进行仓库配料，启用生产前必须发布');
    }
    if (!refs.productTimeProfileId && (!defaultTemplate || defaultTemplate._count.steps === 0)) {
      warnings.push('尚无可用工艺路线，将保留为待编排');
    }
    items.push({
      batchId: batch.id,
      specification: batch.planOrder.specification,
      quantity: batch.quantity,
      warnings,
      blockers,
    });
  }
  return {
    target: input.target,
    batchCount: items.length,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    warnings: items.reduce((sum, item) => sum + item.warnings.length, 0),
    blockers: items.reduce((sum, item) => sum + item.blockers.length, 0),
    items,
  };
}

function batchDto(batch: ProductionPlanOrderRecord['batches'][number]): ProductionPlanBatchDTO {
  const state = batch.releaseState as ProductionPlanReleaseState;
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
    processStatus: (batch.workOrder?.processRoute?.status as ProductionPlanBatchDTO['processStatus']) || 'not_created',
    releasedAt: batch.releasedAt?.toISOString() || null,
    activatedAt: batch.activatedAt?.toISOString() || null,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
  };
}

export function serializeProductionPlanOrder(order: ProductionPlanOrderRecord): ProductionPlanOrderDTO {
  const allocatedQuantity = order.batches.reduce((sum, batch) => sum + batch.quantity, 0);
  const profile = order.drawingLibraryItem?.productTimeProfiles[0] || null;
  return {
    id: order.id,
    sourceOrderNo: order.sourceOrderNo,
    sourceLineNo: order.sourceLineNo,
    customerName: order.customerName,
    salesperson: order.salesperson,
    productName: order.productName,
    specification: order.specification,
    drawingLibraryItemId: order.drawingLibraryItemId,
    drawingFileCount: order.drawingLibraryItem?._count.files || 0,
    orderQuantity: order.orderQuantity,
    allocatedQuantity,
    remainingQuantity: Math.max(0, order.orderQuantity - allocatedQuantity),
    orderDate: chinaDate(order.orderDate),
    customerDueDate: chinaDate(order.customerDueDate),
    priority: order.priority as ProductionPlanPriority,
    status: order.status as ProductionPlanOrderStatus,
    remark: order.remark,
    currentUnitMilliseconds: profile ? productTimeTotalMilliseconds(profile.entries) : null,
    currentProductTimeVersion: profile?.version || null,
    batches: order.batches.map(batchDto),
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

export async function releaseProductionPlanBatch(
  tx: Prisma.TransactionClient,
  input: { batchId: string; target: 'preparation' | 'active'; actorId: string },
): Promise<{ workOrderId: string; warnings: string[]; created: boolean }> {
  const batch = await tx.productionPlanBatch.findUnique({
    where: { id: input.batchId },
    include: { planOrder: true, workOrder: { select: { id: true } } },
  });
  if (!batch || batch.deletedAt || batch.planOrder.deletedAt) throw new Error('PLAN_BATCH_NOT_FOUND');
  if (batch.releaseState === 'archived') throw new Error('PLAN_BATCH_ARCHIVED');
  const references = await resolvePlanningReferences(tx, batch.planOrder);
  const totalMilliseconds = references.unitMilliseconds ? BigInt(references.unitMilliseconds) * BigInt(batch.quantity) : null;
  const code = workOrderCode(batch.planOrder.sourceOrderNo, batch.planOrder.sourceLineNo, batch.batchNo);
  const planActive = input.target === 'active';
  const data = {
    code,
    customerName: batch.planOrder.customerName,
    salesperson: batch.planOrder.salesperson,
    productName: batch.planOrder.productName,
    stage: 'not_issued',
    priority: batch.planOrder.priority === 'insert' ? 'urgent' : batch.planOrder.priority,
    status: 'pending',
    progress: 0,
    plannedAt: batch.plannedCompletionDate,
    remark: batch.planOrder.remark,
    sourceOrderNo: batch.planOrder.sourceOrderNo,
    orderDate: batch.planOrder.orderDate,
    specification: batch.planOrder.specification,
    uncompletedQty: String(batch.quantity),
    productionTargetQty: batch.quantity,
    unitWorkHours: workHours(references.unitMilliseconds),
    totalWorkHours: workHours(totalMilliseconds ? Number(totalMilliseconds) : null),
    deliveryDay: chinaDate(batch.planOrder.customerDueDate),
    materialStatus: '待配料',
    planType: 'managed_plan',
    weekStartDate: batch.weekStartDate,
    weekEndDate: batch.weekEndDate,
    planActive,
    planClearedAt: null,
    planClearedBy: null,
    libraryKey: batch.planOrder.specification,
    drawingLibraryItemId: references.drawingLibraryItemId,
  } satisfies Prisma.WorkOrderUncheckedCreateInput;
  const created = !batch.workOrderId;
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
        },
        select: { id: true },
      })
    : await tx.workOrder.create({ data, select: { id: true } });

  await tx.warehouseMaterialTask.upsert({
    where: { workOrderId: workOrder.id },
    create: { workOrderId: workOrder.id, status: 'pending', updatedById: input.actorId },
    update: {},
  });

  const warnings: string[] = [];
  if (!references.drawingLibraryItemId) warnings.push('未匹配图纸资料，工艺需人工核对');
  if (!references.productTimeProfileId) warnings.push('产品工时尚未发布，暂不计算计划工时');
  try {
    await createWorkOrderProcessRoute(tx, { workOrderId: workOrder.id, actorId: input.actorId });
  } catch (error) {
    const codeValue = error instanceof Error ? error.message : '';
    if (codeValue === 'PROCESS_TEMPLATE_NOT_FOUND' || codeValue === 'PROCESS_TEMPLATE_EMPTY') {
      warnings.push('尚无可用工艺路线，已保留为待编排');
    } else {
      throw error;
    }
  }

  const now = new Date();
  await tx.productionPlanBatch.update({
    where: { id: batch.id },
    data: {
      workOrderId: workOrder.id,
      releaseState: input.target,
      productTimeProfileId: references.productTimeProfileId,
      productTimeProfileVersion: references.productTimeProfileVersion,
      unitMillisecondsSnapshot: references.unitMilliseconds,
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
      afterData: { workOrderId: workOrder.id, releaseState: input.target, planActive },
      impactData: { warehouseTaskCreated: true, processWarnings: warnings.length },
      actorId: input.actorId,
    },
  });
  await tx.operationLog.create({
    data: {
      userId: input.actorId,
      action: input.target === 'active' ? 'release_plan_to_current_week' : 'release_plan_to_next_week',
      targetType: 'production_plan_batch',
      targetId: batch.id,
      detail: { workOrderId: workOrder.id, warnings: warnings.length },
    },
  });
  return { workOrderId: workOrder.id, warnings, created };
}
