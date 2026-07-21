import type { DrawingLibraryFile, DrawingLibraryItem, ResourceCategory, User } from '@prisma/client';
import { invalidSpecificationReason, isInvalidSpecification } from '@/lib/bulk-original-drawing-parser';
import { safeDisplayFilename } from '@/lib/filenames';
import { prisma } from '@/lib/prisma';

export const drawingLibraryRequiredCodes = new Set(['drawing', 'sop', 'product']);
export { invalidSpecificationReason, isInvalidSpecification };

export function cleanDrawingText(value: unknown, max = 200) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

export function parseCustomerCode(customerName?: string | null) {
  const text = customerName?.trim() || '';
  const match = text.match(/\(([^()]*)\)\s*$/);
  return match?.[1]?.trim() || null;
}

export function drawingLibraryKey(customerName: string | null | undefined, specification: string) {
  const spec = specification.trim();
  const customer = customerName?.trim() || '';
  return customer ? `${customer}::${spec}` : spec;
}

export function hasMeaningfulDrawingRemark(remark?: string | null) {
  const text = remark?.trim() || '';
  return !!text && text !== '-';
}

type DrawingLibraryPlanningLink = { id: string };

type DrawingLibraryVisibilityInput = {
  specification?: string | null;
  remark?: string | null;
  lastImportedAt?: Date | string | null;
  lastWorkOrderId?: string | null;
  files?: Array<{ id: string }>;
  productionPlanOrders?: DrawingLibraryPlanningLink[];
};

export function isPlanningLinkedDrawingLibraryItem(item: DrawingLibraryVisibilityInput) {
  return (item.productionPlanOrders?.length || 0) > 0;
}

export function isAutoImportedEmptyDrawingLibraryItem(item: DrawingLibraryVisibilityInput) {
  return !isPlanningLinkedDrawingLibraryItem(item)
    && !!item.lastImportedAt
    && !!item.lastWorkOrderId
    && !hasMeaningfulDrawingRemark(item.remark)
    && (item.files?.length || 0) === 0;
}

export function isVisibleDrawingLibraryItem(item: DrawingLibraryVisibilityInput) {
  if (isInvalidSpecification(item.specification || '')) return false;
  return isPlanningLinkedDrawingLibraryItem(item) || !isAutoImportedEmptyDrawingLibraryItem(item);
}

export function drawingLibraryItemAnomalyReason(item: {
  specification?: string | null;
  libraryKey?: string | null;
  remark?: string | null;
  lastImportedAt?: Date | string | null;
  lastWorkOrderId?: string | null;
  files?: Array<{ id: string }>;
  productionPlanOrders?: DrawingLibraryPlanningLink[];
}) {
  const specReason = invalidSpecificationReason(item.specification || '');
  if (specReason) return specReason;
  const fileCount = item.files?.length || 0;
  if (fileCount === 0 && !hasMeaningfulDrawingRemark(item.remark) && !isPlanningLinkedDrawingLibraryItem(item)) return '无文件空记录';
  if (!item.libraryKey?.trim()) return '未归档记录';
  return '';
}

export function isDrawingLibraryItemAnomaly(item: Parameters<typeof drawingLibraryItemAnomalyReason>[0]) {
  return !!drawingLibraryItemAnomalyReason(item);
}

function versionMinor(version?: string | null) {
  const match = String(version || '').match(/^V1\.(\d+)$/i);
  return match ? Number(match[1]) : -1;
}

export async function nextDrawingLibraryVersion(libraryItemId: string, categoryId: string) {
  const files = await prisma.drawingLibraryFile.findMany({
    where: { libraryItemId, categoryId },
    select: { version: true },
  });
  const max = files.reduce((n, file) => Math.max(n, versionMinor(file.version)), -1);
  return `V1.${max + 1}`;
}

export async function findDrawingLibraryItemForWorkOrder(workOrder: {
  customerName?: string | null;
  specification?: string | null;
}) {
  const specification = workOrder.specification?.trim();
  if (!specification || isInvalidSpecification(specification)) return null;
  const customerName = workOrder.customerName?.trim() || '未设置';
  const key = drawingLibraryKey(customerName === '未设置' ? '' : customerName, specification);
  return prisma.drawingLibraryItem.findFirst({ where: { libraryKey: key, deletedAt: null } });
}

export async function ensureDrawingLibraryItemForWorkOrder(workOrder: {
  id: string;
  customerName?: string | null;
  productName?: string | null;
  specification?: string | null;
}) {
  const specification = workOrder.specification?.trim();
  if (!specification || isInvalidSpecification(specification)) return null;

  const customerName = workOrder.customerName?.trim() || '未设置';
  const key = drawingLibraryKey(customerName === '未设置' ? '' : customerName, specification);
  const existing = await prisma.drawingLibraryItem.findUnique({ where: { libraryKey: key } });
  const data = {
    customerName,
    customerCode: parseCustomerCode(customerName),
    productName: workOrder.productName || existing?.productName || null,
    specification,
    libraryKey: key,
    lastWorkOrderId: workOrder.id,
    lastImportedAt: new Date(),
    deletedAt: null,
  };
  const item = existing
    ? await prisma.drawingLibraryItem.update({ where: { id: existing.id }, data })
    : await prisma.drawingLibraryItem.create({ data });
  return item;
}

export function drawingFileType(file: { mimeType: string; originalName: string; displayName?: string | null }) {
  const filename = safeDisplayFilename(file).toLowerCase();
  if (file.mimeType === 'application/pdf' || filename.endsWith('.pdf')) return 'pdf';
  if (file.mimeType.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(filename)) return 'image';
  return 'other';
}

export type DrawingLibraryFileWithMeta = DrawingLibraryFile & {
  category?: Pick<ResourceCategory, 'id' | 'name' | 'code' | 'sortOrder'> | null;
  uploadedBy?: Pick<User, 'displayName' | 'username'> | null;
};

export type DrawingLibraryItemWithFiles = DrawingLibraryItem & {
  files?: DrawingLibraryFileWithMeta[];
  productionPlanOrders?: DrawingLibraryPlanningLink[];
};

export function serializeDrawingLibraryFile(file: DrawingLibraryFileWithMeta) {
  const fileType = drawingFileType(file);
  return {
    id: file.id,
    libraryItemId: file.libraryItemId,
    categoryId: file.categoryId,
    categoryName: file.category?.name || null,
    categoryCode: file.category?.code || null,
    originalName: file.originalName,
    displayName: file.displayName,
    remark: file.remark,
    mimeType: file.mimeType,
    fileType,
    fileSize: file.size,
    size: file.size,
    version: file.version || 'V1.0',
    uploadedBy: file.uploadedBy?.displayName || file.uploadedBy?.username || null,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
    deletedAt: file.deletedAt?.toISOString() || null,
    contentUrl: `/api/drawing-library/files/${file.id}/content`,
    viewUrl: `/api/drawing-library/files/${file.id}/content`,
    downloadUrl: `/api/drawing-library/files/${file.id}/download`,
  };
}

export function drawingLibraryCompleteness(files: DrawingLibraryFileWithMeta[] = [], categories: Pick<ResourceCategory, 'id' | 'code'>[] = []) {
  const activeFiles = files.filter(file => !file.deletedAt);
  const counts: Record<string, number> = {};
  for (const file of activeFiles) counts[file.categoryId] = (counts[file.categoryId] || 0) + 1;
  const totalCategories = Math.max(categories.length, 5);
  const filledCategories = categories.filter(category => counts[category.id] > 0).length;
  const missingRequired = categories.filter(category => drawingLibraryRequiredCodes.has(category.code) && !counts[category.id]).map(category => category.code);
  return {
    counts,
    fileCount: activeFiles.length,
    filledCategories,
    totalCategories,
    completenessText: `${filledCategories}/${totalCategories}`,
    missingRequired,
    isComplete: missingRequired.length === 0,
  };
}

export function serializeDrawingLibraryItem(item: DrawingLibraryItemWithFiles, categories: Pick<ResourceCategory, 'id' | 'name' | 'code' | 'sortOrder'>[] = []) {
  const files = (item.files || []).filter(file => !file.deletedAt);
  const completeness = drawingLibraryCompleteness(files, categories);
  const anomalyReason = drawingLibraryItemAnomalyReason({ ...item, files });
  return {
    id: item.id,
    customerName: item.customerName,
    customerCode: item.customerCode,
    productName: item.productName,
    specification: item.specification,
    libraryKey: item.libraryKey,
    remark: item.remark,
    deletedAt: item.deletedAt?.toISOString() || null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    lastWorkOrderId: item.lastWorkOrderId,
    lastImportedAt: item.lastImportedAt?.toISOString() || null,
    categoryFileCounts: completeness.counts,
    fileCount: completeness.fileCount,
    filledCategoryCount: completeness.filledCategories,
    totalCategoryCount: completeness.totalCategories,
    completenessText: completeness.completenessText,
    missingRequiredCategories: completeness.missingRequired,
    isComplete: completeness.isComplete,
    isAnomaly: !!anomalyReason,
    anomalyReason,
    files: files.map(serializeDrawingLibraryFile),
  };
}
