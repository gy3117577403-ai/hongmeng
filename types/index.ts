export type WorkOrderDTO = {
  id: string;
  code: string;
  productName: string;
  stage: string;
  stageText?: string;
  progress: number;
  priority: string;
  status: string;
  remark?: string | null;
  plannedAt?: string | null;
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
  workOrderCode?: string | null;
  workOrderProductName?: string | null;
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
  deletedAt?: string | null;
  contentUrl?: string;
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

export type UserDTO = {
  id: string;
  username: string;
  displayName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FieldSummaryDTO = {
  counts: {
    missingWorkOrders: number;
    completeWorkOrders: number;
    recentFiles: number;
    todayWorkOrders: number;
  };
  missingWorkOrders: WorkOrderDTO[];
  completeWorkOrders: WorkOrderDTO[];
  recentFiles: ResourceFileDTO[];
  todayWorkOrders: WorkOrderDTO[];
};

export type TrashDTO = {
  workOrders: WorkOrderDTO[];
  resourceFiles: ResourceFileDTO[];
};
