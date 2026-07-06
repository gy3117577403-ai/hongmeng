import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const sensitiveKeyPattern = /(password|passwordHash|secret|session|token|databaseUrl|DATABASE_URL|signature|signedUrl|objectKey)/i;

type SnapshotInput = {
  entityType: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  changedBy?: string | null;
};

function toPlain(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  return JSON.parse(JSON.stringify(value, (_key, val) => {
    if (val instanceof Date) return val.toISOString();
    return val;
  }));
}

export function sanitizeSnapshotValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  const plain = toPlain(value);
  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(visit);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(
      Object.entries(item as Record<string, unknown>).map(([key, val]) => [
        key,
        sensitiveKeyPattern.test(key) ? '[redacted]' : visit(val),
      ]),
    );
  };
  return visit(plain) as Prisma.InputJsonValue;
}

export async function snapshotChange(input: SnapshotInput) {
  try {
    await prisma.dataChangeSnapshot.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        beforeJson: sanitizeSnapshotValue(input.before),
        afterJson: sanitizeSnapshotValue(input.after),
        changedBy: input.changedBy ?? null,
      },
    });
  } catch {
    console.warn('data change snapshot failed', {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
    });
  }
}

export function workOrderSnapshot(order: {
  id: string;
  code: string;
  customerName?: string | null;
  productName: string;
  stage: string;
  priority: string;
  status: string;
  progress: number;
  plannedAt?: Date | string | null;
  remark?: string | null;
  sourceOrderNo?: string | null;
  salesperson?: string | null;
  orderDate?: Date | string | null;
  customerLevel?: string | null;
  specification?: string | null;
  processName?: string | null;
  uncompletedQty?: string | null;
  unitWorkHours?: string | null;
  totalWorkHours?: string | null;
  drawingStatus?: string | null;
  deliveryDay?: string | null;
  materialStatus?: string | null;
  drawingIssuedAt?: Date | string | null;
  drawingIssueNote?: string | null;
  importBatchId?: string | null;
  sourceSheetName?: string | null;
  sourceRowNo?: number | null;
  planType?: string | null;
  weekStartDate?: Date | string | null;
  weekEndDate?: Date | string | null;
  planActive?: boolean;
  planClearedAt?: Date | string | null;
  planClearedBy?: string | null;
  libraryKey?: string | null;
  drawingLibraryItemId?: string | null;
  deletedAt?: Date | string | null;
}) {
  return {
    id: order.id,
    code: order.code,
    customerName: order.customerName ?? null,
    productName: order.productName,
    stage: order.stage,
    priority: order.priority,
    status: order.status,
    progress: order.progress,
    plannedAt: order.plannedAt ?? null,
    remark: order.remark ?? null,
    sourceOrderNo: order.sourceOrderNo ?? null,
    salesperson: order.salesperson ?? null,
    orderDate: order.orderDate ?? null,
    customerLevel: order.customerLevel ?? null,
    specification: order.specification ?? null,
    processName: order.processName ?? null,
    uncompletedQty: order.uncompletedQty ?? null,
    unitWorkHours: order.unitWorkHours ?? null,
    totalWorkHours: order.totalWorkHours ?? null,
    drawingStatus: order.drawingStatus ?? null,
    deliveryDay: order.deliveryDay ?? null,
    materialStatus: order.materialStatus ?? null,
    drawingIssuedAt: order.drawingIssuedAt ?? null,
    drawingIssueNote: order.drawingIssueNote ?? null,
    importBatchId: order.importBatchId ?? null,
    sourceSheetName: order.sourceSheetName ?? null,
    sourceRowNo: order.sourceRowNo ?? null,
    planType: order.planType ?? null,
    weekStartDate: order.weekStartDate ?? null,
    weekEndDate: order.weekEndDate ?? null,
    planActive: order.planActive ?? true,
    planClearedAt: order.planClearedAt ?? null,
    planClearedBy: order.planClearedBy ?? null,
    libraryKey: order.libraryKey ?? null,
    drawingLibraryItemId: order.drawingLibraryItemId ?? null,
    deletedAt: order.deletedAt ?? null,
  };
}

export function resourceFileSnapshot(file: {
  id: string;
  workOrderId: string;
  categoryId: string;
  originalName: string;
  displayName?: string | null;
  fileType: string;
  fileSize: number;
  version: string;
  remark?: string | null;
  status: string;
  deletedAt?: Date | string | null;
  workOrder?: { code?: string | null } | null;
  category?: { name?: string | null } | null;
}) {
  return {
    id: file.id,
    workOrderId: file.workOrderId,
    workOrderCode: file.workOrder?.code ?? null,
    categoryId: file.categoryId,
    categoryName: file.category?.name ?? null,
    originalName: file.originalName,
    displayName: file.displayName ?? null,
    fileType: file.fileType,
    fileSize: file.fileSize,
    version: file.version,
    remark: file.remark ?? null,
    status: file.status,
    deletedAt: file.deletedAt ?? null,
  };
}

export function connectorParameterSnapshot(item: {
  id: string;
  rowNo?: number | null;
  model?: string | null;
  outerPeelMm?: string | null;
  innerPeelMm?: string | null;
  insertionLengthMm?: string | null;
  remark?: string | null;
  isHighlighted: boolean;
  importBatchId?: string | null;
  deletedAt?: Date | string | null;
}) {
  return {
    id: item.id,
    rowNo: item.rowNo ?? null,
    model: item.model ?? null,
    outerPeelMm: item.outerPeelMm ?? null,
    innerPeelMm: item.innerPeelMm ?? null,
    insertionLengthMm: item.insertionLengthMm ?? null,
    remark: item.remark ?? null,
    isHighlighted: item.isHighlighted,
    importBatchId: item.importBatchId ?? null,
    deletedAt: item.deletedAt ?? null,
  };
}
