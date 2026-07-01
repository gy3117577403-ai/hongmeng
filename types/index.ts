export type WorkOrderDTO = {
  id: string;
  code: string;
  productName: string;
  stage: string;
  progress: number;
  priority: string;
  status: string;
  remark?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  categoryFileCounts?: Record<string, number>;
  totalFileCount?: number;
};

export type ResourceCategoryDTO = { id: string; name: string; code: string; sortOrder: number };

export type ResourceFileDTO = {
  id: string;
  workOrderId: string;
  categoryId: string;
  categoryName?: string | null;
  categoryCode?: string | null;
  originalName: string;
  displayName?: string | null;
  remark?: string | null;
  mimeType: string;
  fileType: string;
  fileSize: number;
  version: string;
  status: string;
  uploadedBy?: string | null;
  createdAt: string;
  updatedAt: string;
  viewUrl: string;
  downloadUrl: string;
};

export type CurrentUserDTO = { id: string; username: string; displayName: string };

export type OperationLogDTO = {
  id: string;
  createdAt: string;
  user: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  detailSummary: string;
};
