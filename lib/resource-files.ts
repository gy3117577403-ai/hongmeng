export function serializeResourceFile(f: {
  id: string;
  workOrderId: string;
  categoryId: string;
  originalName: string;
  displayName: string | null;
  remark: string | null;
  mimeType: string;
  fileType: string;
  fileSize: number;
  version: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  uploadedBy?: { displayName: string | null; username?: string } | null;
  category?: { name: string; code: string } | null;
  workOrder?: { code: string; productName?: string } | null;
}) {
  return {
    id: f.id,
    workOrderId: f.workOrderId,
    workOrderCode: f.workOrder?.code || null,
    workOrderProductName: f.workOrder?.productName || null,
    categoryId: f.categoryId,
    categoryName: f.category?.name || null,
    categoryCode: f.category?.code || null,
    originalName: f.originalName,
    displayName: f.displayName,
    remark: f.remark,
    mimeType: f.mimeType,
    fileType: f.fileType,
    fileSize: f.fileSize,
    version: f.version || 'V1.0',
    status: f.status,
    uploadedBy: f.uploadedBy?.displayName || f.uploadedBy?.username || null,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
    deletedAt: f.deletedAt?.toISOString() || null,
    viewUrl: `/api/resource-files/${f.id}/view`,
    downloadUrl: `/api/resource-files/${f.id}/download`,
  };
}
