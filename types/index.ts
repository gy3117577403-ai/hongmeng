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
  connectorAssemblyManuals?: ConnectorAssemblyManualDTO[];
  connectorAssemblyManualVersions?: ConnectorAssemblyManualTrashVersionDTO[];
  connectorAssemblyManualAssets?: ConnectorAssemblyManualTrashAssetDTO[];
};

export type IssueStatus = 'pending' | 'processing' | 'verifying' | 'closed';
export type IssuePriority = 'urgent' | 'high' | 'normal';
export type IssueType = 'production' | 'planning' | 'technical' | 'quality' | 'material' | 'equipment' | 'other';

export type IssueUserDTO = {
  id: string;
  username: string;
  displayName: string;
};

export type IssueWorkOrderDTO = {
  id: string;
  code: string;
  specification?: string | null;
  customerName?: string | null;
  productName: string;
  stage: string;
  drawingStatus?: string | null;
  materialStatus?: string | null;
  plannedAt?: string | null;
};

export type IssueActivityDTO = {
  id: string;
  action: string;
  content?: string | null;
  fromStatus?: IssueStatus | null;
  toStatus?: IssueStatus | null;
  actor?: IssueUserDTO | null;
  detail?: Record<string, string | number | boolean | null> | null;
  createdAt: string;
};

export type IssueAttachmentDTO = {
  id: string;
  issueId: string;
  originalName: string;
  displayName?: string | null;
  mimeType: string;
  fileType: string;
  size: number;
  uploadedBy?: IssueUserDTO | null;
  createdAt: string;
  contentUrl: string;
  downloadUrl: string;
};

export type IssueDTO = {
  id: string;
  sequence: number;
  code: string;
  title: string;
  type: IssueType;
  priority: IssuePriority;
  status: IssueStatus;
  description?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceCode?: string | null;
  sourceRoute?: string | null;
  sourceAlertCode?: string | null;
  workOrderId?: string | null;
  reporter?: IssueUserDTO | null;
  assignee?: IssueUserDTO | null;
  workOrder?: IssueWorkOrderDTO | null;
  dueAt?: string | null;
  rootCause?: string | null;
  solution?: string | null;
  verificationResult?: string | null;
  resolvedAt?: string | null;
  verifiedAt?: string | null;
  closedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  isOverdue: boolean;
  activityCount: number;
  attachmentCount: number;
  activities?: IssueActivityDTO[];
  attachments?: IssueAttachmentDTO[];
};

export type IssueSummaryDTO = {
  total: number;
  pending: number;
  processing: number;
  verifying: number;
  closed: number;
  overdue: number;
  unassigned: number;
};

export type DetectedIssueDTO = {
  id: string;
  fingerprint: string;
  alertCode: string;
  label: string;
  tone: 'red' | 'orange' | 'amber' | 'blue';
  workOrderId: string;
  workOrderCode: string;
  specification?: string | null;
  customerName?: string | null;
  productName: string;
  sourceRoute: string;
  existingIssueId?: string | null;
  existingIssueStatus?: IssueStatus | null;
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
  manualCount?: number;
};

export type ConnectorAssemblyManualTocDTO = {
  id?: string;
  title: string;
  pageStart: number;
  pageEnd: number;
  sortOrder?: number;
  createdBy?: string;
  createdAt?: string;
};

export type ConnectorAssemblyManualAssetDTO = {
  id: string;
  versionId: string;
  assetType: 'PDF' | 'IMAGE';
  originalName: string;
  displayName?: string | null;
  mimeType: string;
  size: number;
  relativePath?: string | null;
  fileHash?: string | null;
  pageNo?: number | null;
  sortOrder: number;
  isPrimary: boolean;
  uploadedBy?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  contentUrl: string;
  downloadUrl: string;
};

export type ConnectorAssemblyManualVersionDTO = {
  id: string;
  manualId: string;
  revision: string;
  issuedAt?: string | null;
  pageCount?: number | null;
  fileMode: 'PDF' | 'IMAGE_SET';
  isLatest: boolean;
  status?: string | null;
  tocJson: ConnectorAssemblyManualTocDTO[];
  detectedTitle?: string | null;
  parseStatus?: string | null;
  parseWarnings: string[];
  remark?: string | null;
  createdBy?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  assets: ConnectorAssemblyManualAssetDTO[];
};

export type ConnectorAssemblyManualBindingDTO = {
  id: string;
  model?: string | null;
  rowNo?: number | null;
  remark?: string | null;
};

export type ConnectorAssemblyManualDTO = {
  id: string;
  title: string;
  manufacturer?: string | null;
  family?: string | null;
  documentNo?: string | null;
  summary?: string | null;
  keywords?: string | null;
  createdBy?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  versions: ConnectorAssemblyManualVersionDTO[];
  latestVersion?: ConnectorAssemblyManualVersionDTO | null;
  models: string[];
  versionCount: number;
  bindingCount: number;
  bindings: ConnectorAssemblyManualBindingDTO[];
};

export type ConnectorAssemblyManualSearchAssetDTO = {
  id: string;
  manualId: string;
  versionId: string;
  manualTitle: string;
  revision: string;
  originalName: string;
  displayName?: string | null;
  assetType: 'PDF' | 'IMAGE';
  pageNo?: number | null;
  models: string[];
};

export type ConnectorAssemblyManualTrashVersionDTO = ConnectorAssemblyManualVersionDTO & {
  manualTitle: string;
};

export type ConnectorAssemblyManualTrashAssetDTO = ConnectorAssemblyManualAssetDTO & {
  manualTitle: string;
  revision: string;
};

export type ConnectorManualBulkAction = 'create_manual' | 'create_version' | 'duplicate' | 'conflict' | 'invalid' | 'manual_review' | 'skip';

export type ConnectorManualMetadataConfidence = 'confirmed' | 'detected' | 'needs_review';

export type ConnectorManualMetadataConfidenceDTO = {
  defaultTitle: ConnectorManualMetadataConfidence;
  detectedTitle: ConnectorManualMetadataConfidence;
  manufacturer: ConnectorManualMetadataConfidence;
  family: ConnectorManualMetadataConfidence;
  revision: ConnectorManualMetadataConfidence;
  issuedAt: ConnectorManualMetadataConfidence;
  models: ConnectorManualMetadataConfidence;
  chapters: ConnectorManualMetadataConfidence;
};

export type ConnectorManualBulkAssetInputDTO = {
  fileName: string;
  relativePath: string;
  size: number;
  mimeType: string;
  hash: string;
};

export type ConnectorManualBulkCandidateDTO = {
  clientId: string;
  relativePath: string;
  fileName: string;
  size: number;
  mimeType: string;
  fileMode: 'PDF' | 'IMAGE_SET';
  defaultTitle: string;
  detectedTitle: string;
  manufacturerCandidate: string;
  familyCandidate: string;
  revisionCandidate: string;
  issuedAtCandidate: string;
  modelCandidates: string[];
  keywordCandidates: string[];
  chapterCandidates: ConnectorAssemblyManualTocDTO[];
  metadataConfidence: ConnectorManualMetadataConfidenceDTO;
  pageCount: number;
  hash: string;
  parseFailed: boolean;
  warnings: string[];
  assets: ConnectorManualBulkAssetInputDTO[];
};

export type ConnectorManualBulkPreviewRowDTO = ConnectorManualBulkCandidateDTO & {
  action: ConnectorManualBulkAction;
  matchedManualId: string;
  matchedManualTitle: string;
  suggestedVersionAction: string;
  duplicateReason: string;
  conflictReason: string;
  suggestedRevision: string;
  parameterMatches: Array<{ id: string; model: string; matchType: 'unique_match' | 'multiple_matches' }>;
  uniqueParameterIds: string[];
};

export type ConnectorManualBulkPreviewSummaryDTO = {
  totalFiles: number;
  readyCount: number;
  createManualCount: number;
  versionCandidateCount: number;
  duplicateCount: number;
  conflictCount: number;
  invalidCount: number;
  manualReviewCount: number;
};

export type ConnectorManualImportItemDTO = {
  id: string;
  batchId: string;
  clientId: string;
  fileName: string;
  relativePath?: string | null;
  fileMode: 'PDF' | 'IMAGE_SET';
  fileHash?: string | null;
  action: string;
  status: string;
  title: string;
  revision?: string | null;
  manualId?: string | null;
  versionId?: string | null;
  pageCount?: number | null;
  detectedTitle?: string | null;
  errorMessage?: string | null;
  warnings: string[];
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ConnectorManualImportBatchDTO = {
  id: string;
  sourceName?: string | null;
  totalCount: number;
  readyCount: number;
  successCount: number;
  duplicateCount: number;
  failedCount: number;
  skippedCount: number;
  status: string;
  createdBy?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  items: ConnectorManualImportItemDTO[];
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
