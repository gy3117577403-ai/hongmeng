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
  productionTargetQty?: number | null;
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

export type ChangeStatus = 'draft' | 'assessing' | 'implementing' | 'verifying' | 'closed';
export type ChangePriority = 'urgent' | 'high' | 'normal';
export type ChangeType = 'drawing' | 'process' | 'plan' | 'material' | 'document' | 'other';
export type ChangeImpactArea = 'drawing' | 'process' | 'plan' | 'material' | 'document' | 'production';

export type ChangeActivityDTO = {
  id: string;
  action: string;
  content?: string | null;
  fromStatus?: ChangeStatus | null;
  toStatus?: ChangeStatus | null;
  actor?: IssueUserDTO | null;
  detail?: Record<string, string | number | boolean | null> | null;
  createdAt: string;
};

export type ChangeAttachmentDTO = {
  id: string;
  changeRequestId: string;
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

export type ChangeSourceIssueDTO = {
  id: string;
  code: string;
  title: string;
  status: IssueStatus;
};

export type ChangeRequestDTO = {
  id: string;
  sequence: number;
  code: string;
  title: string;
  type: ChangeType;
  priority: ChangePriority;
  status: ChangeStatus;
  reason?: string | null;
  description?: string | null;
  impactAreas: ChangeImpactArea[];
  impactScope?: string | null;
  implementationPlan?: string | null;
  implementationResult?: string | null;
  validationResult?: string | null;
  rollbackPlan?: string | null;
  sourceIssueId?: string | null;
  sourceIssue?: ChangeSourceIssueDTO | null;
  workOrderId?: string | null;
  workOrder?: IssueWorkOrderDTO | null;
  requester?: IssueUserDTO | null;
  owner?: IssueUserDTO | null;
  dueAt?: string | null;
  effectiveAt?: string | null;
  version: number;
  closedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  isOverdue: boolean;
  activityCount: number;
  attachmentCount: number;
  activities?: ChangeActivityDTO[];
  attachments?: ChangeAttachmentDTO[];
};

export type ChangeSummaryDTO = {
  total: number;
  draft: number;
  assessing: number;
  implementing: number;
  verifying: number;
  closed: number;
  overdue: number;
  unassigned: number;
};

export type WarehouseMaterialStatus = 'pending' | 'completed' | 'exception';
export type WarehouseExceptionType = 'shortage' | 'wrong_material' | 'insufficient_quantity' | 'quality_issue' | 'other';

export type WarehouseMaterialActivityDTO = {
  id: string;
  action: string;
  fromStatus?: WarehouseMaterialStatus | null;
  toStatus?: WarehouseMaterialStatus | null;
  content?: string | null;
  actor?: IssueUserDTO | null;
  createdAt: string;
};

export type WarehouseMaterialTaskDTO = {
  id: string;
  workOrderId: string;
  status: WarehouseMaterialStatus;
  statusText: string;
  exceptionType?: WarehouseExceptionType | null;
  exceptionTypeText?: string | null;
  exceptionNote?: string | null;
  expectedAt?: string | null;
  completedAt?: string | null;
  completedBy?: IssueUserDTO | null;
  updatedBy?: IssueUserDTO | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  isExpectedOverdue: boolean;
  workOrder: {
    id: string;
    code: string;
    customerName?: string | null;
    specification?: string | null;
    productName: string;
    processName?: string | null;
    uncompletedQty?: string | null;
    productionTargetQty?: number | null;
    plannedAt?: string | null;
    deliveryDay?: string | null;
    weekStartDate?: string | null;
    weekEndDate?: string | null;
    planActive: boolean;
    stage: string;
  };
  activities?: WarehouseMaterialActivityDTO[];
};

export type WarehouseMaterialSummaryDTO = {
  total: number;
  pending: number;
  completed: number;
  exception: number;
  expectedOverdue: number;
};

export type WarehouseWeekOptionDTO = {
  weekStartDate: string;
  weekEndDate?: string | null;
  active: boolean;
  taskCount: number;
};

export type ProcessStageGroup = 'frontend' | 'backend' | 'finish';
export type ProcessRouteStatus = 'draft' | 'confirmed' | 'in_progress' | 'completed';
export type ProcessStepStatus = 'pending' | 'current' | 'completed' | 'skipped';
export type ProcessTimeBasis = 'per_unit' | 'per_batch';
export type ProductTimeProfileStatus = 'draft' | 'published' | 'archived';

export type ProductProcessTimeEntryDTO = {
  id: string;
  processDefinitionId: string;
  processCode: string;
  processName: string;
  stageGroup: ProcessStageGroup;
  position: number;
  unitMilliseconds: number;
  actionMilliseconds?: number | null;
  occurrences: number;
  setupMilliseconds: number;
  unitLabel: string;
  countsForEfficiency: boolean;
  remark?: string | null;
};

export type ProductTimeProfileDTO = {
  id: string;
  drawingLibraryItemId: string;
  version: number;
  revision: number;
  status: ProductTimeProfileStatus;
  sourceType: string;
  remark?: string | null;
  totalMillisecondsPerUnit: number;
  processCount: number;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: IssueUserDTO | null;
  updatedBy?: IssueUserDTO | null;
  publishedBy?: IssueUserDTO | null;
  entries: ProductProcessTimeEntryDTO[];
};

export type ProductTimeListItemDTO = {
  id: string;
  customerName: string;
  customerCode?: string | null;
  specification: string;
  productName?: string | null;
  updatedAt: string;
  draft?: ProductTimeProfileDTO | null;
  published?: ProductTimeProfileDTO | null;
};

export type ProcessTimeStandardDTO = {
  id: string;
  processDefinitionId: string;
  version: number;
  timeBasis: ProcessTimeBasis;
  unitLabel: string;
  standardMillisecondsPerUnit: number;
  setupMilliseconds: number;
  countsForEfficiency: boolean;
  isCurrent: boolean;
  effectiveFrom: string;
  remark?: string | null;
  createdBy?: IssueUserDTO | null;
  createdAt: string;
};

export type ProcessDefinitionDTO = {
  id: string;
  code: string;
  name: string;
  stageGroup: ProcessStageGroup;
  isActive: boolean;
  sortOrder: number;
  currentStandard?: ProcessTimeStandardDTO | null;
  standardHistory?: ProcessTimeStandardDTO[];
  templateUsageCount?: number;
  routeUsageCount?: number;
};

export type ProcessTemplateStepDTO = {
  id?: string;
  processDefinitionId?: string | null;
  processCode: string;
  processName: string;
  stageGroup: ProcessStageGroup;
  position: number;
  unitsPerProduct?: number;
};

export type ProcessTemplateDTO = {
  id: string;
  templateKey: string;
  name: string;
  version: number;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  createdBy?: IssueUserDTO | null;
  steps: ProcessTemplateStepDTO[];
};

export type WorkOrderProcessStepDTO = ProcessTemplateStepDTO & {
  id: string;
  status: ProcessStepStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  completedBy?: IssueUserDTO | null;
  remark?: string | null;
  standardTimeId?: string | null;
  standardVersion?: number | null;
  timeBasis?: ProcessTimeBasis | null;
  unitLabel?: string | null;
  standardMillisecondsPerUnit?: number | null;
  setupMilliseconds?: number;
  countsForEfficiency?: boolean;
  executionCount?: number;
  productTimeProfileId?: string | null;
  productTimeEntryId?: string | null;
  productTimeProfileVersion?: number | null;
  standardSource?: string;
};

export type ProcessRouteActivityDTO = {
  id: string;
  stepId?: string | null;
  action: string;
  content?: string | null;
  actor?: IssueUserDTO | null;
  createdAt: string;
};

export type WorkOrderProcessRouteDTO = {
  id: string;
  workOrderId: string;
  templateId?: string | null;
  templateName: string;
  templateVersion: number;
  status: ProcessRouteStatus;
  statusText: string;
  version: number;
  confirmedAt?: string | null;
  confirmedBy?: IssueUserDTO | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  stepCount: number;
  completedStepCount: number;
  progress: number;
  currentStep?: WorkOrderProcessStepDTO | null;
  nextStep?: WorkOrderProcessStepDTO | null;
  steps: WorkOrderProcessStepDTO[];
  activities?: ProcessRouteActivityDTO[];
  productTimeProfileId?: string | null;
  productTimeProfileVersion?: number | null;
  routeSource?: string;
};

export type ProcessRouteWorkOrderDTO = {
  id: string;
  code: string;
  customerName?: string | null;
  specification?: string | null;
  productName: string;
  stage: string;
  drawingStatus?: string | null;
  materialStatus?: string | null;
  plannedAt?: string | null;
  deliveryDay?: string | null;
  weekStartDate?: string | null;
  weekEndDate?: string | null;
  planActive: boolean;
  route?: WorkOrderProcessRouteDTO | null;
};

export type ProcessReferenceSource = 'work_order' | 'drawing_library';

export type ProcessReferenceFileDTO = {
  id: string;
  source: ProcessReferenceSource;
  sourceLabel: string;
  workOrderId?: string | null;
  libraryItemId?: string | null;
  categoryId: string;
  categoryName: string;
  categoryCode: 'drawing' | 'sop';
  originalName: string;
  displayName?: string | null;
  mimeType: string;
  fileType: 'pdf' | 'image' | 'other';
  fileSize: number;
  version: string;
  createdAt: string;
  contentUrl: string;
  downloadUrl: string;
};

export type ProcessReferenceCategoryDTO = {
  code: 'drawing' | 'sop';
  name: string;
  fileCount: number;
};

export type ProcessReferencePayloadDTO = {
  workOrderId: string;
  drawingLibraryItemId?: string | null;
  categories: ProcessReferenceCategoryDTO[];
  files: ProcessReferenceFileDTO[];
};

export type ProcessRouteSummaryDTO = {
  total: number;
  missing: number;
  draft: number;
  confirmed: number;
  inProgress: number;
  completed: number;
};

export type EmployeeDTO = {
  id: string;
  employeeNo: string;
  name: string;
  department?: string | null;
  position?: string | null;
  team?: string | null;
  isActive: boolean;
  attendanceEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AttendanceStatus = 'draft' | 'confirmed';
export type AttendanceType = 'normal' | 'leave' | 'absent' | 'rest';
export type AttendanceSegmentType = 'regular' | 'overtime';

export type AttendanceSegmentDTO = {
  type: AttendanceSegmentType;
  startedAt: string;
  endedAt: string;
  durationMilliseconds: number;
};

export type AttendanceRecordDTO = {
  id: string;
  employeeId: string;
  employee: EmployeeDTO;
  workDate: string;
  status: AttendanceStatus;
  attendanceType: AttendanceType;
  plannedMilliseconds: number;
  leaveMilliseconds: number;
  actualMilliseconds: number;
  overtimeMilliseconds: number;
  segments: AttendanceSegmentDTO[];
  source: string;
  remark?: string | null;
  confirmedBy?: { id: string; username: string; displayName: string } | null;
  confirmedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AbnormalTimeCategory =
  | 'equipment'
  | 'material_shortage'
  | 'wrong_material'
  | 'waiting_drawing'
  | 'waiting_technical'
  | 'process_change'
  | 'incoming_quality'
  | 'tooling'
  | 'planning_change'
  | 'power_network_system'
  | 'other';

export type AbnormalTimeQualityStatus = 'pending' | 'confirmed' | 'rejected';
export type AbnormalTimeResolutionStatus = 'open' | 'resolved';

export type AbnormalTimeAllocationDTO = {
  id: string;
  employeeId: string;
  employee: EmployeeDTO;
  durationMilliseconds: number;
};

export type AbnormalTimeEventDTO = {
  id: string;
  sequence: number;
  workDate: string;
  category: AbnormalTimeCategory;
  categoryLabel: string;
  title: string;
  reason?: string | null;
  startedAt: string;
  endedAt: string;
  durationMilliseconds: number;
  affectedPersonMilliseconds: number;
  employeeExempt: boolean;
  qualityStatus: AbnormalTimeQualityStatus;
  qualityNote?: string | null;
  qualityConfirmedBy?: { id: string; username: string; displayName: string } | null;
  qualityConfirmedAt?: string | null;
  resolutionStatus: AbnormalTimeResolutionStatus;
  responsibilityDepartment?: string | null;
  expectedResolvedAt?: string | null;
  resolutionNote?: string | null;
  resolvedBy?: { id: string; username: string; displayName: string } | null;
  resolvedAt?: string | null;
  workOrder?: {
    id: string;
    code: string;
    customerName?: string | null;
    specification?: string | null;
    productName: string;
  } | null;
  processStep?: { id: string; processCode: string; processName: string } | null;
  allocations: AbnormalTimeAllocationDTO[];
  createdAt: string;
  updatedAt: string;
};

export type ProcessExecutionContextDTO = {
  stepId: string;
  processName: string;
  processCode: string;
  targetQuantity: number;
  suggestedStartedAt: string;
  suggestedEndedAt: string;
  standard?: {
    standardTimeId?: string | null;
    version?: number | null;
    timeBasis: ProcessTimeBasis;
    unitLabel: string;
    standardMillisecondsPerUnit: number;
    setupMilliseconds: number;
    unitsPerProduct: number;
    countsForEfficiency: boolean;
    source?: string;
    productTimeProfileVersion?: number | null;
  } | null;
  employees: EmployeeDTO[];
};

export type ProcessExecutionDTO = {
  id: string;
  stepId: string;
  employee: EmployeeDTO;
  workOrderId: string;
  workOrderCode: string;
  customerName?: string | null;
  specification?: string | null;
  productName: string;
  processCode: string;
  processName: string;
  startedAt: string;
  endedAt: string;
  breakMilliseconds: number;
  goodQty: number;
  scrapQty: number;
  reworkQty: number;
  timeBasis: ProcessTimeBasis;
  unitLabel: string;
  standardMillisecondsPerUnit: number;
  setupMilliseconds: number;
  unitsPerProduct: number;
  standardLaborMilliseconds: number;
  actualLaborMilliseconds: number;
  attainmentBasisPoints: number;
  countsForEfficiency: boolean;
  source: string;
  standardSource?: string;
  productTimeProfileVersion?: number | null;
  remark?: string | null;
  createdAt: string;
};

export type EmployeeAttainmentRowDTO = {
  employee: EmployeeDTO;
  standardLaborMilliseconds: number;
  actualLaborMilliseconds: number;
  attendanceMilliseconds: number;
  exemptAbnormalMilliseconds: number;
  effectiveProductionMilliseconds: number;
  attainmentCapacityMilliseconds: number;
  unexplainedMilliseconds: number;
  attendanceConfirmedDays: number;
  attendanceMissing: boolean;
  attainmentBasisPoints: number | null;
  processEfficiencyBasisPoints: number;
  rawAttendanceOutputBasisPoints: number | null;
  coverageBasisPoints: number | null;
  goodQty: number;
  scrapQty: number;
  reworkQty: number;
  executionCount: number;
  details: ProcessExecutionDTO[];
};

export type EmployeeAttainmentReportDTO = {
  period: 'today' | 'week' | 'month';
  date: string;
  rangeStart: string;
  rangeEnd: string;
  summary: {
    employeeCount: number;
    executionCount: number;
    standardLaborMilliseconds: number;
    actualLaborMilliseconds: number;
    attendanceMilliseconds: number;
    exemptAbnormalMilliseconds: number;
    effectiveProductionMilliseconds: number;
    attainmentCapacityMilliseconds: number;
    unexplainedMilliseconds: number;
    attendanceConfirmedDays: number;
    attendanceMissingCount: number;
    attainmentBasisPoints: number | null;
    processEfficiencyBasisPoints: number;
    rawAttendanceOutputBasisPoints: number | null;
    coverageBasisPoints: number | null;
    goodQty: number;
    scrapQty: number;
    reworkQty: number;
  };
  rows: EmployeeAttainmentRowDTO[];
};

export type AbnormalTimeReportDTO = {
  period: 'today' | 'week' | 'month';
  date: string;
  rangeStart: string;
  rangeEnd: string;
  summary: {
    eventCount: number;
    pendingCount: number;
    confirmedCount: number;
    rejectedCount: number;
    openCount: number;
    incidentMilliseconds: number;
    affectedPersonMilliseconds: number;
    confirmedExemptPersonMilliseconds: number;
  };
  categories: Array<{
    category: AbnormalTimeCategory;
    categoryLabel: string;
    eventCount: number;
    incidentMilliseconds: number;
    affectedPersonMilliseconds: number;
  }>;
  events: AbnormalTimeEventDTO[];
};

export type WorkflowProcessStatus = 'waiting' | 'processing' | 'verifying' | 'closed';
export type WorkflowEntityType = 'issue' | 'change' | 'production';

export type WorkflowStepDTO = {
  key: string;
  label: string;
  state: 'done' | 'current' | 'pending';
};

export type WorkflowActivityDTO = {
  id: string;
  action: string;
  label: string;
  actor?: string | null;
  createdAt: string;
};

export type WorkflowItemDTO = {
  id: string;
  entityId: string;
  entityType: WorkflowEntityType;
  code: string;
  title: string;
  subtitle: string;
  processStatus: WorkflowProcessStatus;
  currentStep: string;
  nextStep?: string | null;
  priority: 'urgent' | 'high' | 'normal';
  owner?: string | null;
  dueAt?: string | null;
  updatedAt: string;
  route: string;
  sourceRoute?: string | null;
  isOverdue: boolean;
  steps: WorkflowStepDTO[];
  activities: WorkflowActivityDTO[];
};

export type WorkflowSummaryDTO = {
  total: number;
  waiting: number;
  processing: number;
  verifying: number;
  closed: number;
  overdue: number;
  issue: number;
  change: number;
  production: number;
};

export type WorkflowTemplateDTO = {
  key: WorkflowEntityType;
  name: string;
  description: string;
  steps: string[];
  route: string;
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

export type KnowledgeArticleCategory = 'problem' | 'process' | 'inspection' | 'equipment' | 'packaging' | 'general';
export type KnowledgeArticleStatus = 'draft' | 'published' | 'archived';
export type KnowledgeSourceType = 'article' | 'drawing' | 'manual' | 'parameter' | 'process' | 'issue' | 'change';

export type KnowledgeRelationDTO = {
  id: string;
  articleId: string;
  sourceType: KnowledgeSourceType;
  sourceId: string;
  sourceLabel?: string | null;
  sourceHref?: string | null;
  createdAt: string;
};

export type KnowledgeAttachmentDTO = {
  id: string;
  articleId: string;
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

export type KnowledgeArticleDTO = {
  id: string;
  sequence: number;
  code: string;
  title: string;
  category: KnowledgeArticleCategory;
  status: KnowledgeArticleStatus;
  summary?: string | null;
  content: string;
  tags: string[];
  customerName?: string | null;
  specification?: string | null;
  productModel?: string | null;
  version: number;
  createdBy?: IssueUserDTO | null;
  updatedBy?: IssueUserDTO | null;
  createdAt: string;
  updatedAt: string;
  attachmentCount: number;
  relationCount: number;
  attachments: KnowledgeAttachmentDTO[];
  relations: KnowledgeRelationDTO[];
};

export type KnowledgePreviewDTO = {
  fileId: string;
  title: string;
  fileType: 'pdf' | 'image';
  contentUrl: string;
  downloadUrl: string;
};

export type KnowledgeSearchItemDTO = {
  key: string;
  sourceType: KnowledgeSourceType;
  sourceId: string;
  title: string;
  subtitle?: string | null;
  summary?: string | null;
  sourceHref: string;
  updatedAt: string;
  badges: string[];
  customerName?: string | null;
  specification?: string | null;
  productModel?: string | null;
  category?: KnowledgeArticleCategory | null;
  preview?: KnowledgePreviewDTO | null;
  article?: KnowledgeArticleDTO | null;
  drawing?: DrawingLibraryItemDTO | null;
  manual?: ConnectorAssemblyManualDTO | null;
  parameter?: ConnectorParameterDTO | null;
};

export type KnowledgeOverviewDTO = {
  totalSources: number;
  articleCount: number;
  drawingCount: number;
  manualCount: number;
  parameterCount: number;
  processCount: number;
  experienceCount: number;
  changeCount: number;
  draftCount: number;
  updatedThisWeek: number;
};
