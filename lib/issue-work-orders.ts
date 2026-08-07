import { Prisma } from '@prisma/client';
import { allocateBusinessWorkOrderCode } from '@/lib/work-order-business-code';
import { createWorkOrderProcessRoute } from '@/lib/process-routing';
import { prisma } from '@/lib/prisma';
import { displayWorkOrderCode, normalizeWorkOrderStage, stageText } from '@/lib/work-orders';
import type { IssueWorkOrderDraftDTO, IssueWorkOrderOptionDTO } from '@/types';

export const issueWorkOrderOptionSelect = Prisma.validator<Prisma.WorkOrderSelect>()({
  id: true,
  code: true,
  businessCode: true,
  customerName: true,
  productName: true,
  specification: true,
  sourceOrderNo: true,
  stage: true,
  status: true,
  drawingStatus: true,
  planActive: true,
  planClearedAt: true,
  branchType: true,
  deletedAt: true,
  updatedAt: true,
});

export type IssueWorkOrderOptionRecord = Prisma.WorkOrderGetPayload<{
  select: typeof issueWorkOrderOptionSelect;
}>;

function cleanDraftText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function parseIssueWorkOrderDraft(value: unknown): {
  draft: IssueWorkOrderDraftDTO | null;
  errors: string[];
} {
  if (value === undefined || value === null) return { draft: null, errors: [] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { draft: null, errors: ['待创建工单格式不正确'] };
  }
  const source = value as Record<string, unknown>;
  const draft: IssueWorkOrderDraftDTO = {
    code: cleanDraftText(source.code, 80),
    productName: cleanDraftText(source.productName, 120),
    customerName: cleanDraftText(source.customerName, 120),
    specification: cleanDraftText(source.specification, 180),
    sourceOrderNo: cleanDraftText(source.sourceOrderNo, 120),
    remark: cleanDraftText(source.remark, 500),
  };
  const errors: string[] = [];
  if (!draft.code) errors.push('待创建工单的工单号不能为空');
  if (!draft.productName) errors.push('待创建工单的产品名称不能为空');
  return { draft, errors };
}

export function issueWorkOrderSearchWhere(keyword: string): Prisma.WorkOrderWhereInput {
  const normalized = keyword.trim().slice(0, 160);
  return {
    deletedAt: null,
    ...(normalized ? {
      OR: [
        { code: { contains: normalized, mode: 'insensitive' } },
        { businessCode: { contains: normalized, mode: 'insensitive' } },
        { sourceOrderNo: { contains: normalized, mode: 'insensitive' } },
        { productName: { contains: normalized, mode: 'insensitive' } },
        { specification: { contains: normalized, mode: 'insensitive' } },
        { customerName: { contains: normalized, mode: 'insensitive' } },
      ],
    } : {}),
  };
}

function issueWorkOrderExactWhere(keyword: string): Prisma.WorkOrderWhereInput | null {
  const normalized = keyword.trim().slice(0, 160);
  if (!normalized) return null;
  return {
    deletedAt: null,
    OR: [
      { code: { equals: normalized, mode: 'insensitive' } },
      { businessCode: { equals: normalized, mode: 'insensitive' } },
      { sourceOrderNo: { equals: normalized, mode: 'insensitive' } },
      { specification: { equals: normalized, mode: 'insensitive' } },
    ],
  };
}

export function issueWorkOrderPageOffset(page: number, pageSize: number, hasExactMatch: boolean): number {
  if (page <= 1) return 0;
  return Math.max(0, (page - 1) * pageSize - (hasExactMatch ? 1 : 0));
}

export function serializeIssueWorkOrderOption(order: IssueWorkOrderOptionRecord): IssueWorkOrderOptionDTO {
  const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
  return {
    id: order.id,
    code: order.code,
    businessCode: order.businessCode,
    displayCode: displayWorkOrderCode(order),
    customerName: order.customerName,
    productName: order.productName,
    specification: order.specification,
    sourceOrderNo: order.sourceOrderNo,
    stage,
    stageText: stageText[stage],
    drawingStatus: order.drawingStatus,
    planActive: order.planActive,
    planClearedAt: order.planClearedAt?.toISOString() || null,
    branchType: order.branchType,
    updatedAt: order.updatedAt.toISOString(),
  };
}

export async function loadIssueWorkOrderOptions(input: {
  keyword?: string;
  page?: number;
  pageSize?: number;
  selectedId?: string;
  selectedOnly?: boolean;
}) {
  const keyword = String(input.keyword || '').trim().slice(0, 160);
  const page = Math.max(1, Math.min(Math.trunc(input.page || 1), 100_000));
  const pageSize = Math.max(1, Math.min(Math.trunc(input.pageSize || 50), 100));
  const selectedId = String(input.selectedId || '').trim().slice(0, 80);
  const selectedPromise = selectedId
    ? prisma.workOrder.findFirst({
        where: { id: selectedId, deletedAt: null },
        select: issueWorkOrderOptionSelect,
      })
    : Promise.resolve(null);

  if (input.selectedOnly) {
    const selected = await selectedPromise;
    return {
      items: [] as IssueWorkOrderOptionDTO[],
      selected: selected ? serializeIssueWorkOrderOption(selected) : null,
      pagination: { page: 1, pageSize, total: 0, totalPages: 1 },
    };
  }

  const where = issueWorkOrderSearchWhere(keyword);
  const exactWhere = issueWorkOrderExactWhere(keyword);
  const exact = exactWhere
    ? await prisma.workOrder.findFirst({
        where: exactWhere,
        select: issueWorkOrderOptionSelect,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      })
    : null;
  const generalWhere: Prisma.WorkOrderWhereInput = exact
    ? { AND: [where, { id: { not: exact.id } }] }
    : where;
  const includeExact = page === 1 && !!exact;
  const take = Math.max(0, pageSize - (includeExact ? 1 : 0));
  const [records, total, selected] = await Promise.all([
    take
      ? prisma.workOrder.findMany({
          where: generalWhere,
          select: issueWorkOrderOptionSelect,
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          skip: issueWorkOrderPageOffset(page, pageSize, !!exact),
          take,
        })
      : Promise.resolve([] as IssueWorkOrderOptionRecord[]),
    prisma.workOrder.count({ where }),
    selectedPromise,
  ]);
  const items = [...(includeExact && exact ? [exact] : []), ...records].map(serializeIssueWorkOrderOption);
  return {
    items,
    selected: selected ? serializeIssueWorkOrderOption(selected) : null,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

export class IssueWorkOrderConflictError extends Error {
  readonly existingWorkOrder: IssueWorkOrderOptionDTO;
  readonly softDeleted: boolean;

  constructor(existingWorkOrder: IssueWorkOrderOptionDTO, softDeleted = false) {
    super(softDeleted ? '工单号存在于回收站' : '工单号已存在');
    this.name = 'IssueWorkOrderConflictError';
    this.existingWorkOrder = existingWorkOrder;
    this.softDeleted = softDeleted;
  }
}

export async function createIssueWorkOrder(
  tx: Prisma.TransactionClient,
  draft: IssueWorkOrderDraftDTO,
  actorId: string,
) {
  const normalizedCode = draft.code.toLowerCase();
  await tx.$queryRaw(Prisma.sql`
    SELECT 1::integer AS locked
    FROM pg_advisory_xact_lock(hashtextextended(${normalizedCode}, 0))
  `);
  const existing = await tx.workOrder.findFirst({
    where: { code: { equals: draft.code, mode: 'insensitive' } },
    select: issueWorkOrderOptionSelect,
  });
  if (existing) throw new IssueWorkOrderConflictError(serializeIssueWorkOrderOption(existing), !!existing.deletedAt);

  const specification = draft.specification || null;
  const customerName = draft.customerName || null;
  const libraryKey = specification || draft.code;
  const businessCode = await allocateBusinessWorkOrderCode(tx, {
    specification,
    productName: draft.productName,
    plannedAt: null,
  });
  const workOrder = await tx.workOrder.create({
    data: {
      code: draft.code,
      businessCode,
      customerName,
      productName: draft.productName,
      stage: 'not_issued',
      priority: 'normal',
      status: 'pending',
      progress: 0,
      remark: draft.remark || '由问题管理快速创建，图纸、产品工序与工时待补充',
      specification,
      sourceOrderNo: draft.sourceOrderNo || null,
      drawingStatus: '待补充',
      planType: 'manual',
      planActive: true,
      libraryKey,
      drawingLibraryItemId: null,
    },
  });
  await createWorkOrderProcessRoute(tx, { workOrderId: workOrder.id, actorId });
  await tx.operationLog.create({
    data: {
      userId: actorId,
      action: 'create_work_order_from_issue',
      targetType: 'work_order',
      targetId: workOrder.id,
      detail: {
        code: workOrder.code,
        drawingLibraryItemId: workOrder.drawingLibraryItemId,
        dataPending: true,
      },
    },
  });
  return workOrder;
}
