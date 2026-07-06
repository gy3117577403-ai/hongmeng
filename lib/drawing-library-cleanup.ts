import { prisma } from '@/lib/prisma';
import { hasMeaningfulDrawingRemark, isAutoImportedEmptyDrawingLibraryItem } from '@/lib/drawing-library';

type CleanupItem = {
  id: string;
  customerName: string;
  productName: string | null;
  specification: string;
  remark: string | null;
  lastImportedAt: Date | null;
  lastWorkOrderId: string | null;
  files: Array<{ id: string }>;
};

export type DrawingLibraryCleanupSummary = {
  totalActive: number;
  candidateCount: number;
  customerCount: number;
  specificationCount: number;
  retainedCount: number;
  withFileCount: number;
  withRemarkCount: number;
  connectorParameterCount: number;
  connectorParameterFileCount: number;
  workOrderCount: number;
  samples: Array<{
    id: string;
    customerName: string;
    specification: string;
    productName: string | null;
    lastImportedAt: string | null;
    lastWorkOrderId: string | null;
  }>;
};

function sampleItem(item: CleanupItem) {
  return {
    id: item.id,
    customerName: item.customerName,
    specification: item.specification,
    productName: item.productName,
    lastImportedAt: item.lastImportedAt?.toISOString() || null,
    lastWorkOrderId: item.lastWorkOrderId,
  };
}

async function loadCleanupScope() {
  const [items, connectorParameterCount, connectorParameterFileCount, workOrderCount] = await Promise.all([
    prisma.drawingLibraryItem.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        customerName: true,
        productName: true,
        specification: true,
        remark: true,
        lastImportedAt: true,
        lastWorkOrderId: true,
        files: { select: { id: true } },
      },
    }),
    prisma.connectorParameter.count(),
    prisma.connectorParameterFile.count(),
    prisma.workOrder.count(),
  ]);
  return { items, connectorParameterCount, connectorParameterFileCount, workOrderCount };
}

export async function previewEmptyDrawingLibraryCleanup(): Promise<DrawingLibraryCleanupSummary> {
  const { items, connectorParameterCount, connectorParameterFileCount, workOrderCount } = await loadCleanupScope();
  const candidates = items.filter(isAutoImportedEmptyDrawingLibraryItem);
  const withFileCount = items.filter(item => item.files.length > 0).length;
  const withRemarkCount = items.filter(item => hasMeaningfulDrawingRemark(item.remark)).length;
  return {
    totalActive: items.length,
    candidateCount: candidates.length,
    customerCount: new Set(candidates.map(item => item.customerName)).size,
    specificationCount: new Set(candidates.map(item => item.specification)).size,
    retainedCount: items.length - candidates.length,
    withFileCount,
    withRemarkCount,
    connectorParameterCount,
    connectorParameterFileCount,
    workOrderCount,
    samples: candidates.slice(0, 20).map(sampleItem),
  };
}

export async function commitEmptyDrawingLibraryCleanup() {
  const { items } = await loadCleanupScope();
  const ids = items.filter(isAutoImportedEmptyDrawingLibraryItem).map(item => item.id);
  if (!ids.length) return { count: 0 };
  const result = await prisma.drawingLibraryItem.updateMany({
    where: { id: { in: ids }, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return { count: result.count };
}
