export type WorkOrderDTO = {
  id: string;
  code: string;
  displayCode?: string;
  customerName?: string | null;
  productName: string;
  stage: string;
  stageText?: string;
  progress: number;
  priority: string;
  status: string;
  remark?: string | null;
  plannedAt?: string | null;
  sourceOrderNo?: string | null;
  salesperson?: string | null;
  orderDate?: string | null;
  customerLevel?: string | null;
  specification?: string | null;
  processName?: string | null;
  uncompletedQty?: string | null;
  unitWorkHours?: string | null;
  totalWorkHours?: string | null;
  drawingStatus?: string | null;
  deliveryDay?: string | null;
  materialStatus?: string | null;
  drawingIssuedAt?: string | null;
  drawingIssueNote?: string | null;
  importBatchId?: string | null;
  sourceSheetName?: string | null;
  sourceRowNo?: number | null;
  planType?: string | null;
  weekStartDate?: string | null;
  weekEndDate?: string | null;
  planActive?: boolean;
  planClearedAt?: string | null;
  planClearedBy?: string | null;
  libraryKey?: string | null;
  drawingLibraryItemId?: string | null;
  productionOwner?: string | null;
  workstation?: string | null;
  completedQty?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  lastProgressAt?: string | null;
  latestProgressRemark?: string | null;
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

export type DrawingLibraryFileDTO = {
  id: string;
  libraryItemId: string;
  categoryId: string;
  categoryName?: string | null;
  categoryCode?: string | null;
  originalName: string;
  displayName?: string | null;
  remark?: string | null;
  mimeType: string;
  fileType: string;
  fileSize: number;
  size: number;
  version: string;
  uploadedBy?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  contentUrl: string;
  viewUrl: string;
  downloadUrl: string;
};

export type DrawingLibraryItemDTO = {
  id: string;
  customerName: string;
  customerCode?: string | null;
  productName?: string | null;
  specification: string;
  libraryKey: string;
  remark?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  lastWorkOrderId?: string | null;
  lastImportedAt?: string | null;
  categoryFileCounts: Record<string, number>;
  fileCount: number;
  filledCategoryCount: number;
  totalCategoryCount: number;
  completenessText: string;
  missingRequiredCategories: string[];
  isComplete: boolean;
  isAnomaly: boolean;
  anomalyReason: string;
  files: DrawingLibraryFileDTO[];
};

export type DrawingLibraryCustomerDTO = {
  customerName: string;
  customerCode?: string | null;
  itemCount: number;
  missingCount: number;
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

export type ConnectorParameterDTO = {
  id: string;
  rowNo?: number | null;
  model?: string | null;
  outerPeelMm?: string | null;
  innerPeelMm?: string | null;
  insertionLengthMm?: string | null;
  remark?: string | null;
  isHighlighted: boolean;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  importBatchId?: string | null;
};

export type ConnectorParameterFileDTO = {
  id: string;
  originalName: string;
  displayName?: string | null;
  mimeType: string;
  fileType: string;
  fileSize: number;
  uploadedBy?: string | null;
  createdAt: string;
  deletedAt?: string | null;
  downloadUrl: string;
};

export type ConnectorParameterStatsDTO = {
  total: number;
  missingOuter: number;
  missingInner: number;
  missingInsertion: number;
  missingAny?: number;
  highlighted: number;
  fileCount: number;
};

export type ConnectorImportPreviewRowDTO = {
  index: number;
  rowNo?: number | null;
  model?: string | null;
  outerPeelMm?: string | null;
  innerPeelMm?: string | null;
  insertionLengthMm?: string | null;
  remark?: string | null;
  isHighlighted: boolean;
  status: 'ready' | 'duplicate' | 'invalid' | 'skipped';
  reason: string;
};

export type ConnectorImportPreviewSummaryDTO = {
  totalRows: number;
  readyCount: number;
  duplicateCount: number;
  invalidCount: number;
  skippedCount: number;
  highlightedCount: number;
};

export type ChangeSnapshotDTO = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  changedBy?: string | null;
  createdAt: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  summary?: string;
};

export type ConnectorParameterImportBatchDTO = {
  id: string;
  sourceType: string;
  fileName?: string | null;
  totalRows: number;
  readyCount: number;
  duplicateCount: number;
  invalidCount: number;
  skippedCount: number;
  insertedCount: number;
  duplicateStrategy: string;
  createdBy?: string | null;
  createdAt: string;
  rolledBackAt?: string | null;
  rolledBackBy?: string | null;
  activeParameterCount?: number;
};
