export type WorkOrderBranchType = 'REWORK' | 'SCRAP_REPLENISH' | 'QUALITY_PENDING';
export type WorkOrderBranchStatus = 'OPEN' | 'RELEASED' | 'IN_PROGRESS' | 'QUALITY_PENDING' | 'RESOLVED' | 'CANCELLED';

export type WorkOrderDTO = {
  id: string;
  code: string;
  businessCode?: string | null;
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
  parentWorkOrderId?: string | null;
  rootWorkOrderId?: string | null;
  branchType?: WorkOrderBranchType | null;
  branchStatus?: WorkOrderBranchStatus | null;
  originCompletionId?: string | null;
  originStepId?: string | null;
  rejoinStepId?: string | null;
  branchSequence?: number | null;
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
  sourcePdfOverlayVersionId?: string | null;
  controlMode?: 'controlled' | 'uncontrolled' | null;
  supersedesFileId?: string | null;
  isCurrent: boolean;
  contentUrl: string;
  viewUrl: string;
  downloadUrl: string;
};

export type SopStageDTO = 'standard' | 'new_product' | 'validating';
export type SopDrawingStatusDTO = 'available' | 'missing';
export type SopMetadataDTO = {
  id: string;
  sopStage: SopStageDTO;
  drawingStatus: SopDrawingStatusDTO;
  remark: string | null;
  updatedAt: string;
};

export type ProductDataRecordDTO = {
  id: string;
  drawingLibraryItemId: string;
  kind: 'MATERIAL' | 'NOTICE' | 'CUSTOM' | string;
  label: string | null;
  payload: Record<string, unknown>;
  version: number;
  status: string;
  sourceType: string;
  sourceSampleEntryId: string | null;
  supersedesRecordId: string | null;
  publishedBy: string | null;
  publishedAt: string;
};

export type ProductConnectorParameterBindingDTO = {
  id: string;
  drawingLibraryItemId: string;
  connectorParameterId: string;
  positionLabel: string | null;
  version: number;
  isCurrent: boolean;
  sourceSampleEntryId: string | null;
  publishedBy: string | null;
  publishedAt: string;
  parameter: {
    id: string;
    model: string | null;
    outerPeelMm: string | null;
    innerPeelMm: string | null;
    insertionLengthMm: string | null;
    remark: string | null;
  };
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
  sopMetadata?: SopMetadataDTO | null;
  files: DrawingLibraryFileDTO[];
  structuredRecords?: ProductDataRecordDTO[];
  connectorParameters?: ProductConnectorParameterBindingDTO[];
};

export type SampleTaskStatusDTO = 'PLANNED' | 'IN_PROGRESS' | 'SUBMITTED' | 'COMPLETED' | 'CANCELLED';
export type SampleDataStatusDTO = 'NO_DATA' | 'COLLECTING' | 'PENDING_REVIEW' | 'NEEDS_CHANGES' | 'PARTIALLY_PUBLISHED' | 'PROCESSED';
export type SampleReviewStatusDTO = 'DRAFT' | 'PENDING' | 'CHANGES_REQUESTED' | 'APPROVED' | 'PUBLISHED' | 'VOIDED';
export type SampleDataKindDTO = 'PROCESS_TIME' | 'STRIPPING' | 'MATERIAL' | 'NOTICE' | 'CUSTOM';
export type SamplePhotoCategoryDTO = 'UNCLASSIFIED' | 'PROCESS' | 'MEASUREMENT' | 'FINISHED' | 'DETAIL' | 'EXCEPTION';
export type SamplePublishModeDTO = 'APPEND' | 'REPLACE_MATCHING' | 'RECORD_ONLY';

export type SampleTaskAssigneeDTO = {
  id: string;
  employeeId: string;
  employeeNo: string;
  name: string;
  team: string | null;
  position: string | null;
};

export type SampleDataEntryDTO = {
  id: string;
  taskId: string;
  kind: SampleDataKindDTO;
  label: string | null;
  payload: Record<string, unknown>;
  reviewStatus: SampleReviewStatusDTO;
  publishMode: SamplePublishModeDTO | null;
  reviewComment: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  publishedBy: string | null;
  publishedAt: string | null;
  publishedEntityType: string | null;
  publishedEntityId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type SamplePhotoDTO = {
  id: string;
  taskId: string;
  category: SamplePhotoCategoryDTO;
  caption: string | null;
  originalName: string;
  mimeType: string;
  size: number;
  captureSource: string | null;
  reviewStatus: SampleReviewStatusDTO;
  reviewComment: string | null;
  uploadedBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  publishedBy: string | null;
  publishedAt: string | null;
  publishedFileId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  contentUrl: string;
};

export type SampleTaskDTO = {
  id: string;
  code: string;
  qrCode: string;
  captureUrl: string;
  drawingLibraryItemId: string;
  sourceOrderNo: string | null;
  customerName: string;
  productName: string | null;
  specification: string;
  customerLevelCode: string | null;
  customerLevelLabel: string | null;
  customerLevelColor: string | null;
  sampleQuantity: number | null;
  dueDate: string | null;
  priority: number;
  status: SampleTaskStatusDTO;
  dataStatus: SampleDataStatusDTO;
  planRemark: string | null;
  version: number;
  startedAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  assignees: SampleTaskAssigneeDTO[];
  entries: SampleDataEntryDTO[];
  photos: SamplePhotoDTO[];
  counts: {
    data: number;
    photos: number;
    pendingReview: number;
    changesRequested: number;
    published: number;
  };
};

export type SampleTeamSummaryDTO = {
  total: number;
  dueToday: number;
  overdue: number;
  pendingReview: number;
  collecting: number;
  completed: number;
  publishedItems: number;
};

export type DrawingLibraryCustomerDTO = {
  customerName: string;
  customerCode?: string | null;
  itemCount: number;
  missingCount: number;
};

export type LaborAccessRoleDTO = 'ADMIN' | 'TEAM_LEAD' | 'EMPLOYEE';
export type DailyPlanningRoleDTO = 'WORKSHOP_SUPERVISOR' | 'TEAM_LEADER' | 'MEMBER';
export type AccountStatusDTO = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
export type AccessProfileKeyDTO =
  | 'ADMIN_GLOBAL'
  | 'DEPARTMENT_FULL'
  | 'PROCESS_SPECIALIST'
  | 'DRAWING_LIBRARY_READER'
  | 'DRAWING_LIBRARY_EDITOR'
  | 'REPORT_PEOPLE_READER'
  | 'QUALITY_REVIEWER'
  | 'FIELD_REPORTER'
  | 'GM_OFFICE_READER_APPROVER'
  | 'FINANCE_ACCOUNT_ONLY'
  | 'WORKSHOP_SUPERVISOR'
  | 'WORKSHOP_TEAM_LEADER'
  | 'PLANNING_COLLABORATOR'
  | 'PRODUCTION_COLLABORATOR'
  | 'MATERIAL_FOLLOW_UP_OPERATOR'
  | 'TRAINING_COLLABORATOR';
export type AccessGrantTypeDTO = 'PRIMARY' | 'CONCURRENT' | 'ACTING';

export type DepartmentRefDTO = {
  id: string;
  code: string;
  name: string;
  isActive?: boolean;
  sortOrder?: number;
};

export type AccessModuleCodeDTO =
  | 'BASIC_SUMMARY'
  | 'ACCOUNT_SELF'
  | 'NOTIFICATIONS'
  | 'FIELD_REPORT'
  | 'BUSINESS'
  | 'PROCUREMENT'
  | 'WAREHOUSE'
  | 'ENGINEERING'
  | 'QUALITY'
  | 'PROCESS'
  | 'ISSUE_MANAGEMENT'
  | 'CHANGE_MANAGEMENT'
  | 'DRAWING_LIBRARY'
  | 'ASSEMBLY_MANUALS'
  | 'PRODUCT_TIME'
  | 'ATTENDANCE'
  | 'REPORT_CENTER'
  | 'TERMINAL_TOOLING'
  | 'PLANNING'
  | 'HR'
  | 'TRAINING'
  | 'PRODUCTION'
  | 'MAJOR_APPROVAL'
  | 'ACCOUNT_ADMIN'
  | 'SYSTEM_CONFIGURATION';
export type AccessActionCodeDTO = 'READ' | 'CREATE' | 'UPDATE' | 'DELETE' | 'EXECUTE_WORKFLOW' | 'APPROVE' | 'MANAGE' | 'PERMANENT_DELETE';
export type CapabilityCodeDTO = `${AccessModuleCodeDTO}:${AccessActionCodeDTO}`;
export type AccessScopeLevelDTO = 'GLOBAL' | 'DEPARTMENT' | 'WORKSHOP' | 'TEAM' | 'SELF';
export type ProductionScopeLevelDTO = 'NONE' | 'TEAM' | 'WORKSHOP' | 'GLOBAL';

export type ResolvedAccessGrantDTO = {
  id?: string;
  profile: AccessProfileKeyDTO;
  grantType: AccessGrantTypeDTO;
  departmentCode?: string | null;
  scopeKey: string;
  isActive?: boolean;
  effectiveFrom?: string | number | Date | null;
  effectiveTo?: string | number | Date | null;
};

export type AccessScopeHintDTO = {
  module: AccessModuleCodeDTO;
  level: AccessScopeLevelDTO;
  readOnly: boolean;
  grantType: AccessGrantTypeDTO;
  scopeKey: string;
  sourceGrantId?: string;
  departmentCode?: string;
  workshopId?: string;
  teamId?: string;
};

export type AccessContextDTO = {
  accountActive: boolean;
  effectiveGrants: readonly ResolvedAccessGrantDTO[];
  capabilities: readonly CapabilityCodeDTO[];
  modules: readonly AccessModuleCodeDTO[];
  scopeHints: readonly AccessScopeHintDTO[];
  productionScope: ProductionScopeLevelDTO;
};

export type UserAccessGrantDTO = {
  id: string;
  profileKey: AccessProfileKeyDTO;
  departmentId: string | null;
  scopeKey: string;
  grantType: AccessGrantTypeDTO;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  version: number;
  department?: DepartmentRefDTO | null;
};

export type FieldPinSummaryDTO = {
  configured: boolean;
  isActive: boolean;
  isLocked: boolean;
  lockedUntil: string | null;
  lastUsedAt: string | null;
  resetAt: string | null;
  updatedAt: string | null;
};

export type EmployeeLinkedUserDTO = {
  id: string;
  username: string;
  displayName?: string;
  accountStatus?: AccountStatusDTO | null;
  isActive: boolean;
  mustChangePassword?: boolean;
  fieldPasswordOnly?: boolean;
  passwordSetupRequired?: boolean;
  lastLoginAt?: string | null;
  permissionSummary?: {
    configuredGrantCount: number;
    activeGrantCount: number;
    profiles: AccessProfileKeyDTO[];
    departmentCodes: string[];
    fieldReportEnabled: boolean;
    permissionSyncPending: boolean;
    pin?: FieldPinSummaryDTO;
  };
};

export type CurrentUserDTO = {
  id: string;
  username: string;
  displayName: string;
  accountStatus: AccountStatusDTO;
  mustChangePassword: boolean;
  fieldPasswordOnly?: boolean;
  lastLoginAt: string | null;
  laborRole: LaborAccessRoleDTO;
  employeeId: string | null;
  employee: {
    id: string;
    employeeNo: string;
    name: string;
    department: string | null;
    departmentId: string | null;
    position: string | null;
    team: string | null;
    isActive: boolean;
  } | null;
  access: AccessContextDTO;
  dailyPlanningRoles: DailyPlanningRoleDTO[];
  dailyPlanningTeamIds: string[];
  canAccessDailyPlans: boolean;
  canAccessWeeklyProcesses: boolean;
  canManageDailyPlanningOrganization: boolean;
};

export type SystemNotificationCategoryDTO = 'SYSTEM' | 'ACCOUNT' | 'TODO' | 'APPROVAL';

export type SystemNotificationPriorityDTO = 'NORMAL' | 'HIGH' | 'URGENT';

export type SystemNotificationDTO = {
  id: string;
  eventType: string;
  category: SystemNotificationCategoryDTO;
  priority: SystemNotificationPriorityDTO;
  title: string;
  body: string | null;
  targetRoute: string | null;
  sourceType: string | null;
  sourceId: string | null;
  actorName: string | null;
  readAt: string | null;
  createdAt: string;
};

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
  accountStatus?: AccountStatusDTO | null;
  mustChangePassword?: boolean;
  fieldPasswordOnly?: boolean;
  passwordSetupRequired?: boolean;
  lastLoginAt?: string | null;
  laborRole: LaborAccessRoleDTO;
  employeeId: string | null;
  employee: {
    id: string;
    employeeNo: string;
    name: string;
    department?: string | null;
    departmentId?: string | null;
    departmentRecord?: DepartmentRefDTO | null;
    position?: string | null;
    team: string | null;
    isActive: boolean;
  } | null;
  accessMethods?: {
    workbench: boolean;
    fieldReport: boolean;
    pin: boolean;
  };
  fieldPin?: FieldPinSummaryDTO;
  permissionSyncPending?: boolean;
  accessGrants?: UserAccessGrantDTO[];
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

export type IssueStatus = 'pending' | 'processing' | 'verifying' | 'awaiting_confirmation' | 'closed';
export type IssuePriority = 'urgent' | 'high' | 'normal';
export type IssueType = 'production' | 'planning' | 'technical' | 'process' | 'quality' | 'material' | 'equipment' | 'other';
export type IssueAttachmentCategory = 'site_original' | 'root_cause' | 'processing' | 'verification' | 'archive' | 'other';
export type MajorQualityApprovalStatusDTO =
  | 'PENDING_QUALITY_REVIEW'
  | 'PENDING_GM_APPROVAL'
  | 'APPROVED'
  | 'QUALITY_RETURNED'
  | 'GM_RETURNED'
  | 'CANCELLED';

export type IssueMajorApprovalSummaryDTO = {
  id: string;
  round: number;
  status: MajorQualityApprovalStatusDTO;
  version: number;
  submittedByName?: string | null;
  submittedAt: string;
  qualityReviewedByName?: string | null;
  qualityReviewedAt?: string | null;
  finalReviewedByName?: string | null;
  finalReviewedAt?: string | null;
};

export type IssueUserDTO = {
  id: string;
  username: string;
  displayName: string;
};

export type IssueEmployeeDTO = {
  id: string;
  employeeNo: string;
  name: string;
  displayName: string;
  username: string;
  department?: string | null;
  position?: string | null;
  team?: string | null;
  isActive: boolean;
};

export type IssueAssigneeOptionDTO = {
  id: string;
  employeeNo: string;
  name: string;
  department?: string | null;
  position?: string | null;
  team?: string | null;
  isActive: boolean;
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

export type IssueWorkOrderOptionDTO = {
  id: string;
  code: string;
  businessCode?: string | null;
  displayCode: string;
  customerName?: string | null;
  productName: string;
  specification?: string | null;
  sourceOrderNo?: string | null;
  stage: string;
  stageText: string;
  drawingStatus?: string | null;
  planActive?: boolean;
  planClearedAt?: string | null;
  branchType?: WorkOrderBranchType | null;
  updatedAt?: string;
};

export type IssueWorkOrderDraftDTO = {
  code: string;
  productName: string;
  customerName: string;
  specification: string;
  sourceOrderNo: string;
  remark: string;
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
  category: IssueAttachmentCategory;
  stage: IssueStatus;
  caption?: string | null;
  version: number;
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
  assignee?: IssueEmployeeDTO | null;
  verifier?: IssueEmployeeDTO | null;
  collaborators: IssueEmployeeDTO[];
  workOrder?: IssueWorkOrderDTO | null;
  dueAt?: string | null;
  processName?: string | null;
  affectedQuantity?: number | null;
  temporaryMeasure?: string | null;
  rootCause?: string | null;
  solution?: string | null;
  verificationResult?: string | null;
  requesterConfirmedBy?: IssueUserDTO | null;
  requesterConfirmedAt?: string | null;
  requesterConfirmationNote?: string | null;
  isMajorQuality: boolean;
  majorQualityReason?: string | null;
  version: number;
  majorApproval?: IssueMajorApprovalSummaryDTO | null;
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
  awaiting_confirmation: number;
  closed: number;
  overdue: number;
  unassigned: number;
};

export type EightDReportStatus = 'active' | 'archived';

export type EightDReportProductDTO = {
  id: string;
  customerName: string;
  customerCode?: string | null;
  productName?: string | null;
  specification: string;
};

export type EightDReportIssueDTO = {
  id: string;
  sequence: number;
  code: string;
  title: string;
  status: IssueStatus;
  priority: IssuePriority;
  type: IssueType;
  affectedQuantity?: number | null;
  workOrder?: IssueWorkOrderDTO | null;
  createdAt: string;
  updatedAt: string;
};

export type EightDReportVersionDTO = {
  id: string;
  reportId: string;
  versionNumber: number;
  versionLabel: string;
  originalName: string;
  displayName?: string | null;
  mimeType: string;
  size: number;
  sha256: string;
  pageCount?: number | null;
  note?: string | null;
  uploadedBy?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  contentUrl: string;
  downloadUrl: string;
};

export type EightDReportActivityDTO = {
  id: string;
  action: string;
  content?: string | null;
  actorName: string;
  detail?: Record<string, unknown> | null;
  createdAt: string;
};

export type EightDReportDTO = {
  id: string;
  sequence: number;
  reportNo: string;
  title: string;
  reportDate?: string | null;
  responsibleDepartment?: string | null;
  keywords?: string | null;
  status: EightDReportStatus;
  version: number;
  currentVersionId?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: string | null;
  updatedBy?: string | null;
  products: EightDReportProductDTO[];
  issues: EightDReportIssueDTO[];
  versions: EightDReportVersionDTO[];
  currentVersion?: EightDReportVersionDTO | null;
  activities: EightDReportActivityDTO[];
};

export type EightDReportSummaryDTO = {
  total: number;
  active: number;
  archived: number;
  deleted: number;
  productCount: number;
  issueCount: number;
  unlinked: number;
};

export type EightDReportOptionsDTO = {
  products: EightDReportProductDTO[];
  issues: EightDReportIssueDTO[];
};

export type InternalQualityRiskStatus = 'DRAFT' | 'SUBMITTED' | 'CONTAINMENT' | 'COLLABORATING' | 'VERIFYING' | 'PENDING_CLOSE' | 'REVISING' | 'ARCHIVED';
export type InternalQualityRiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type WorkOrderQualityAlertState = 'ACTIVE' | 'ACKNOWLEDGED' | 'SUPERSEDED' | 'REVOKED' | 'EXPIRED';
export type InternalQualityRiskWarningState = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED' | 'EXPIRED' | 'REVOKED';
export type InternalQualityRiskPrintPolicy = 'REQUIRED' | 'OPTIONAL' | 'SYSTEM_ONLY';
export type InternalQualityRiskTaskStatus = 'TODO' | 'IN_PROGRESS' | 'COMPLETED' | 'VERIFIED' | 'CANCELLED';
export type InternalQualityRiskTaskType = 'CONTAINMENT' | 'CAUSE' | 'ACTION' | 'VERIFICATION' | 'COLLABORATION';

export type InternalQualityRiskWorkOrderDTO = {
  id: string;
  code: string;
  businessCode?: string | null;
  displayCode: string;
  customerName?: string | null;
  productName: string;
  specification?: string | null;
  stage: string;
  drawingLibraryItemId?: string | null;
  planActive: boolean;
  deletedAt?: string | null;
  source?: 'DIRECT' | 'PRODUCT_CONFIRMATION' | 'PRODUCT_AUTO';
};

export type InternalQualityRiskProductDTO = EightDReportProductDTO & {
  deletedAt?: string | null;
};

export type InternalQualityRiskIssueDTO = {
  id: string;
  sequence: number;
  code: string;
  title: string;
  type: IssueType;
  priority: IssuePriority;
  status: IssueStatus;
  isMajorQuality: boolean;
  majorApproval?: {
    id: string;
    round: number;
    status: string;
    completedAt?: string | null;
  } | null;
  workOrder?: InternalQualityRiskWorkOrderDTO | null;
  deletedAt?: string | null;
};

export type InternalQualityRiskEightDDTO = {
  id: string;
  reportNo: string;
  title: string;
  status: EightDReportStatus;
  deletedAt?: string | null;
};

export type InternalQualityRiskRevisionDTO = {
  id: string;
  revisionNumber: number;
  archivedAt: string;
  archivedById?: string | null;
};

export type InternalQualityRiskAlertSummaryDTO = {
  id: string;
  revisionId: string;
  revisionNumber: number;
  workOrder: InternalQualityRiskWorkOrderDTO;
  state: WorkOrderQualityAlertState;
  source: 'DIRECT_ARCHIVE' | 'PRODUCT_SUGGESTION_CONFIRMED' | 'PRODUCT_AUTO_ARCHIVE';
  severity: InternalQualityRiskSeverity;
  acknowledgementCount: number;
  archivedAt: string;
  updatedAt: string;
};

export type InternalQualityRiskActivityDTO = {
  id: string;
  action: string;
  content?: string | null;
  actorName: string;
  detail?: Record<string, unknown> | null;
  createdAt: string;
};

export type InternalQualityRiskTaskDTO = {
  id: string;
  taskType: InternalQualityRiskTaskType;
  title: string;
  department: string;
  ownerName?: string | null;
  requirement?: string | null;
  result?: string | null;
  status: InternalQualityRiskTaskStatus;
  dueAt?: string | null;
  completedAt?: string | null;
  verifiedAt?: string | null;
  sortOrder: number;
  attachmentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type InternalQualityRiskAttachmentDTO = {
  id: string;
  taskId?: string | null;
  category: 'DEFECT' | 'CAUSE' | 'ACTION' | 'VERIFICATION' | 'SOLUTION' | 'EVIDENCE';
  originalName: string;
  displayName: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  caption?: string | null;
  sortOrder: number;
  uploadedBy?: string | null;
  createdAt: string;
  deletedAt?: string | null;
  contentUrl: string;
};

export type InternalQualityRiskDTO = {
  id: string;
  sequence: number;
  reportNo: string;
  title: string;
  severity: InternalQualityRiskSeverity;
  status: InternalQualityRiskStatus;
  occurrenceDate?: string | null;
  workshopArea?: string | null;
  processName?: string | null;
  responsibleDepartment?: string | null;
  defectPhenomenon?: string | null;
  occurrenceCause?: string | null;
  escapeCause?: string | null;
  systemCause?: string | null;
  rootCause?: string | null;
  secondaryCause?: string | null;
  containmentAction?: string | null;
  disposition?: string | null;
  correctiveAction?: string | null;
  preventiveAction?: string | null;
  verificationResult?: string | null;
  finalConclusion?: string | null;
  evidenceSummary?: string | null;
  riskScope?: string | null;
  applicableProcess?: string | null;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  warningState: InternalQualityRiskWarningState;
  warningSummary?: string | null;
  requiredAction?: string | null;
  inspectionMethod?: string | null;
  inspectionFrequency?: string | null;
  acceptanceCriteria?: string | null;
  stopConditions?: string | null;
  escalationContact?: string | null;
  printPolicy: InternalQualityRiskPrintPolicy;
  warningPublishedAt?: string | null;
  warningRevokedAt?: string | null;
  warningRevokeReason?: string | null;
  version: number;
  currentRevisionId?: string | null;
  currentRevisionNumber?: number | null;
  archivedAt?: string | null;
  deletedAt?: string | null;
  deleteReason?: string | null;
  purgeEligibleAt?: string | null;
  canPurge: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: string | null;
  updatedBy?: string | null;
  archivedBy?: string | null;
  deletedBy?: string | null;
  products: InternalQualityRiskProductDTO[];
  issues: InternalQualityRiskIssueDTO[];
  workOrders: InternalQualityRiskWorkOrderDTO[];
  eightDReports: InternalQualityRiskEightDDTO[];
  revisions: InternalQualityRiskRevisionDTO[];
  alerts: InternalQualityRiskAlertSummaryDTO[];
  tasks: InternalQualityRiskTaskDTO[];
  attachments: InternalQualityRiskAttachmentDTO[];
  activities: InternalQualityRiskActivityDTO[];
};

export type InternalQualityRiskSummaryDTO = {
  total: number;
  draft: number;
  revising: number;
  archived: number;
  deleted: number;
  critical: number;
  activeAlerts: number;
  unlinked: number;
  submitted: number;
  collaborating: number;
  verifying: number;
  pendingClose: number;
  overdueTasks: number;
};

export type InternalQualityRiskOptionIssueDTO = Omit<InternalQualityRiskIssueDTO, 'majorApproval' | 'deletedAt'> & {
  majorApprovalStatus?: string | null;
  updatedAt: string;
};

export type InternalQualityRiskOptionEightDDTO = {
  id: string;
  reportNo: string;
  title: string;
  status: EightDReportStatus;
  updatedAt: string;
};

export type InternalQualityRiskOptionsDTO = {
  products: EightDReportProductDTO[];
  issues: InternalQualityRiskOptionIssueDTO[];
  workOrders: InternalQualityRiskWorkOrderDTO[];
  eightDReports: InternalQualityRiskOptionEightDDTO[];
};

export type InternalQualityRiskReadinessDTO = {
  ready: boolean;
  blockers: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  revisionNumber: number;
  workOrderCount: number;
  productCount: number;
  issueCount: number;
  alertCount: number;
};

export type WorkOrderQualityAlertAcknowledgementDTO = {
  id: string;
  note?: string | null;
  acknowledgedAt: string;
  acknowledgedBy?: string | null;
  acknowledgedById: string;
};

export type WorkOrderQualityAlertDTO = {
  id: string;
  reportId: string;
  reportNo: string;
  reportTitle: string;
  reportVersion: number;
  revisionId: string;
  revisionNumber: number;
  workOrderId: string;
  state: WorkOrderQualityAlertState;
  persistedState: Exclude<WorkOrderQualityAlertState, 'EXPIRED'>;
  source: 'DIRECT_ARCHIVE' | 'PRODUCT_SUGGESTION_CONFIRMED' | 'PRODUCT_AUTO_ARCHIVE';
  severity: InternalQualityRiskSeverity;
  title: string;
  defectPhenomenon?: string | null;
  rootCause?: string | null;
  finalConclusion?: string | null;
  controlRequirement?: string | null;
  warningSummary?: string | null;
  requiredAction?: string | null;
  inspectionMethod?: string | null;
  inspectionFrequency?: string | null;
  acceptanceCriteria?: string | null;
  stopConditions?: string | null;
  escalationContact?: string | null;
  printPolicy: InternalQualityRiskPrintPolicy;
  applicableProcess?: string | null;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  archivedAt: string;
  supersededAt?: string | null;
  revokedAt?: string | null;
  revokeReason?: string | null;
  createdAt: string;
  updatedAt: string;
  workOrder: InternalQualityRiskWorkOrderDTO;
  acknowledgements: WorkOrderQualityAlertAcknowledgementDTO[];
};

export type WorkOrderQualityRiskSuggestionDTO = {
  id: string;
  reportNo: string;
  title: string;
  severity: InternalQualityRiskSeverity;
  defectPhenomenon?: string | null;
  rootCause?: string | null;
  finalConclusion?: string | null;
  applicableProcess?: string | null;
  effectiveUntil?: string | null;
  version: number;
  revisionNumber?: number | null;
  archivedAt?: string | null;
  reason: string;
};

export type WorkOrderQualityAlertsDTO = {
  workOrder: InternalQualityRiskWorkOrderDTO;
  alerts: WorkOrderQualityAlertDTO[];
  suggestions: WorkOrderQualityRiskSuggestionDTO[];
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

export type ChangeProcessRouteStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'ACTIVATING'
  | 'ACTIVE'
  | 'FAILED';

export type ChangeProcessRouteDTO = {
  id: string;
  routeId: string;
  status: ChangeProcessRouteStatus;
  baseRouteVersion: number;
  activatedRouteVersion?: number | null;
  reviewDecision?: string | null;
  reviewedAt?: string | null;
  activatedAt?: string | null;
  activationError?: string | null;
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
  processRouteChange?: ChangeProcessRouteDTO | null;
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

export type WarehouseMaterialExceptionCaseDTO = {
  id: string;
  sequence: number;
  status: 'OPEN' | 'RESOLVED' | 'CANCELLED';
  exceptionType: WarehouseExceptionType;
  exceptionTypeText: string;
  exceptionNote: string;
  weekStartDate?: string | null;
  weekEndDate?: string | null;
  reportedAt: string;
  reportedBy?: IssueUserDTO | null;
  expectedArrivalAt?: string | null;
  expectedArrivalBy?: IssueUserDTO | null;
  expectedArrivalUpdatedAt?: string | null;
  actualArrivalAt?: string | null;
  actualArrivalBy?: IssueUserDTO | null;
  resolvedAt?: string | null;
  resolvedBy?: IssueUserDTO | null;
  resolutionNote?: string | null;
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
  carryover?: {
    label: '上周遗留' | '更早遗留';
    originalWeekStartDate: string;
  } | null;
  followUpTask?: {
    id: string;
    status: MaterialFollowUpStatusDTO;
    statusText: string;
    owner?: IssueUserDTO | null;
    expectedAt?: string | null;
    latestProgress?: string | null;
    updatedAt: string;
  } | null;
  lastResolvedException?: WarehouseMaterialExceptionCaseDTO | null;
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

export type MaterialFollowUpStatusDTO =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'WAITING_ARRIVAL'
  | 'WAITING_WAREHOUSE'
  | 'RESOLVED'
  | 'CANCELLED';

export type MaterialFollowUpRiskDTO = 'overdue' | 'unassigned' | 'due_soon' | 'normal' | 'closed';

export type MaterialFollowUpActivityDTO = {
  id: string;
  action: string;
  fromStatus?: MaterialFollowUpStatusDTO | null;
  toStatus?: MaterialFollowUpStatusDTO | null;
  content?: string | null;
  actor?: IssueUserDTO | null;
  createdAt: string;
};

export type MaterialFollowUpTaskDTO = {
  id: string;
  warehouseTaskId: string;
  warehouseExceptionId: string;
  status: MaterialFollowUpStatusDTO;
  statusText: string;
  risk: MaterialFollowUpRiskDTO;
  riskText: string;
  owner?: IssueUserDTO | null;
  createdBy?: IssueUserDTO | null;
  resolvedBy?: IssueUserDTO | null;
  latestProgress?: string | null;
  expectedAt?: string | null;
  lastFollowedAt?: string | null;
  resolvedAt?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  carryover?: {
    label: '上周遗留' | '更早遗留';
    originalWeekStartDate: string;
  } | null;
  warehouseTask: {
    status: WarehouseMaterialStatus;
    exceptionType?: WarehouseExceptionType | null;
    exceptionNote?: string | null;
    expectedAt?: string | null;
  };
  exceptionCase: WarehouseMaterialExceptionCaseDTO;
  workOrder: {
    id: string;
    code: string;
    customerName?: string | null;
    specification?: string | null;
    productName: string;
    productionTargetQty?: number | null;
    uncompletedQty?: string | null;
    plannedAt?: string | null;
    deliveryDay?: string | null;
    weekStartDate?: string | null;
    weekEndDate?: string | null;
    planActive: boolean;
    priority: string;
    planning?: {
      batchId: string;
      orderId: string;
      releaseState: string;
      weekStartDate: string;
      weekEndDate: string;
      plannedCompletionDate: string;
      customerDueDate: string;
      updatedAt: string;
    } | null;
  };
  activities?: MaterialFollowUpActivityDTO[];
};

export type MaterialFollowUpSummaryDTO = {
  total: number;
  pending: number;
  inProgress: number;
  waitingArrival: number;
  waitingWarehouse: number;
  resolved: number;
  overdue: number;
  unassigned: number;
};

export type WarehouseWeekOptionDTO = {
  weekStartDate: string;
  weekEndDate?: string | null;
  active: boolean;
  taskCount: number;
};

export type ProductionPlanPriority = 'normal' | 'urgent' | 'insert';
export type ProductionPlanOrderStatus = 'pending' | 'scheduled' | 'partially_released' | 'released' | 'paused' | 'cancelled' | 'completed';
export type ProductionPlanReleaseState = 'draft' | 'preparation' | 'active' | 'archived';
export type PlanningFlowStatus =
  | 'material_exception'
  | 'missing_drawing'
  | 'missing_sop'
  | 'missing_time'
  | 'pending_material'
  | 'pending_process'
  | 'ready_release'
  | 'next_preparation'
  | 'current_execution'
  | 'production'
  | 'pending_archive'
  | 'completed';

export type ProductionPlanProductOptionDTO = {
  id: string;
  customerName: string;
  customerCode?: string | null;
  specification: string;
  productName: string;
  fileCount: number;
  drawingFileCount: number;
  sopFileCount: number;
  sopStage?: SopStageDTO | null;
  sopDrawingStatus?: SopDrawingStatusDTO | null;
  sopRemark?: string | null;
  sopMetadataUpdatedAt?: string | null;
  recommendedSalesperson?: string | null;
  publishedProductTimeVersion?: number | null;
  unitMilliseconds?: number | null;
  qualityWarningCount?: number;
  highestQualityWarningSeverity?: InternalQualityRiskSeverity | null;
  qualityWarningPrintRequired?: boolean;
};

export type ProductionPlanBatchDTO = {
  id: string;
  planOrderId: string;
  batchNo: number;
  quantity: number;
  weekStartDate: string;
  weekEndDate: string;
  plannedCompletionDate: string;
  releaseState: ProductionPlanReleaseState;
  workOrderId?: string | null;
  productTimeProfileId?: string | null;
  productTimeProfileVersion?: number | null;
  unitMillisecondsSnapshot?: number | null;
  totalMillisecondsSnapshot?: string | null;
  warehouseStatus?: WarehouseMaterialStatus | 'not_created';
  processStatus?: ProcessRouteStatus | 'not_created';
  warehouseCompletedAt?: string | null;
  processConfirmedAt?: string | null;
  processStartedAt?: string | null;
  processCompletedAt?: string | null;
  workOrderStartedAt?: string | null;
  workOrderCompletedAt?: string | null;
  currentProcessName?: string | null;
  currentProcessStartedAt?: string | null;
  travelerPrintStatus?: 'not_printed' | 'generated' | 'partial' | 'printed' | 'needs_reprint' | 'legacy_unverified';
  travelerPrintMode?: 'TRAVELER_ONLY' | 'TRAVELER_QUALITY_WARNING' | 'TRAVELER_SOP_DUPLEX' | 'TRAVELER_SOP_SEPARATE' | 'DRAWING_SOP_TRAVELER_SEPARATE' | 'DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX' | 'CUSTOM' | null;
  travelerPrintMaterials?: Partial<Record<'TRAVELER' | 'QUALITY_WARNING' | 'SOP' | 'DRAWING', {
    status: 'generated' | 'printed' | 'needs_reprint' | 'legacy_unverified';
    copies: number;
    confirmedAt: string | null;
  }>> | null;
  travelerPrintId?: string | null;
  travelerPrintGeneratedAt?: string | null;
  travelerPrintConfirmedAt?: string | null;
  releasedAt?: string | null;
  activatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProductionPlanOrderDTO = {
  id: string;
  sourceOrderNo: string;
  sourceLineNo: number;
  customerName: string;
  salesperson?: string | null;
  productName: string;
  specification: string;
  drawingLibraryItemId?: string | null;
  drawingFileCount: number;
  sopFileCount: number;
  sopStage?: SopStageDTO | null;
  sopDrawingStatus?: SopDrawingStatusDTO | null;
  sopRemark?: string | null;
  sopMetadataUpdatedAt?: string | null;
  qualityWarningCount?: number;
  highestQualityWarningSeverity?: InternalQualityRiskSeverity | null;
  qualityWarningPrintRequired?: boolean;
  orderQuantity: number;
  planningUnitMilliseconds?: number | null;
  effectiveUnitMilliseconds?: number | null;
  planningTotalMilliseconds?: string | null;
  allocatedQuantity: number;
  remainingQuantity: number;
  orderDate: string;
  customerDueDate: string;
  priority: ProductionPlanPriority;
  status: ProductionPlanOrderStatus;
  remark?: string | null;
  currentUnitMilliseconds?: number | null;
  currentProductTimeVersion?: number | null;
  batches: ProductionPlanBatchDTO[];
  createdAt: string;
  updatedAt: string;
};

export type ProductionPlanChangeDTO = {
  id: string;
  planOrderId?: string | null;
  batchId?: string | null;
  action: string;
  reason?: string | null;
  beforeData?: Record<string, string | number | boolean | null> | null;
  afterData?: Record<string, string | number | boolean | null> | null;
  impactData?: Record<string, string | number | boolean | null> | null;
  actor?: IssueUserDTO | null;
  createdAt: string;
};

export type ProductionPlanningWeekDTO = {
  weekStartDate: string;
  weekEndDate: string;
  batchCount: number;
  totalQuantity: number;
  unfinishedCount?: number;
};

export type ProductionPlanningPeriodsDTO = {
  current: ProductionPlanningWeekDTO;
  next: ProductionPlanningWeekDTO;
  afterNext: ProductionPlanningWeekDTO;
  history: ProductionPlanningWeekDTO[];
};

export type ProductionPlanningSummaryDTO = {
  orderCount: number;
  pendingOrderCount: number;
  scheduledOrderCount: number;
  thisWeekBatchCount: number;
  nextWeekBatchCount: number;
  preparationBatchCount: number;
  activeBatchCount: number;
  missingDrawingCount: number;
  missingSopCount: number;
  missingProductTimeCount: number;
  warehouseExceptionCount: number;
  processPendingCount: number;
};

export type ProcessStageGroup = 'frontend' | 'backend' | 'finish';
export type ProcessRouteStatus = 'draft' | 'confirmed' | 'in_progress' | 'completed';
export type ProcessStepStatus = 'pending' | 'current' | 'completed' | 'skipped';
export type ProcessTimeBasis = 'per_unit' | 'per_batch';
export type ProcessReportQuantityBasis = 'product' | 'action';
export type ProcessReportingPolicy = 'free_sequence' | 'strict_sequence';
export type ProductTimeProfileStatus = 'draft' | 'published' | 'archived' | 'discarded';

export type ProductTimeDeploymentStatus = 'preview' | 'pending' | 'applying' | 'active' | 'failed';

export type ProductTimeDeploymentDiffKind = 'insert' | 'move' | 'update_time' | 'delete';
export type ProductTimeInsertPolicy = 'AUTO_BY_PROGRESS' | 'FUTURE_ONLY' | 'RECALL_REWORK';

export type ProductTimeDeploymentWorkOrderState = 'unstarted' | 'in_progress' | 'completed';

export type ProductTimeDeploymentRouteStatus = 'pending' | 'applying' | 'succeeded' | 'failed' | 'blocked' | 'unchanged';

export type ProductTimeDeploymentDiffDTO = {
  kind: ProductTimeDeploymentDiffKind;
  occurrenceKey: string;
  processDefinitionId?: string | null;
  processName: string;
  previousProcessName?: string | null;
  oldSequence?: number | null;
  newSequence?: number | null;
  oldUnitMilliseconds?: number | null;
  newUnitMilliseconds?: number | null;
  isCritical?: boolean;
  policy?: ProductTimeInsertPolicy | null;
  policyRequired?: boolean;
};

export type ProductTimeDeploymentConflictDTO = {
  code: string;
  message: string;
  workOrderId?: string | null;
  workOrderCode?: string | null;
};

export type ProductTimeDeploymentImpactDTO = {
  workOrders: {
    total: number;
    unstarted: number;
    inProgress: number;
    completed: number;
  };
  historicalReports: number;
  affectedEmployees: number;
  attainmentRecords: number;
  supplementObligations: number;
  keptCompleted: number;
  systemCoveredQty: number;
  actualRequiredQty: number;
  generatedLaborRecords: number;
  qrTickets: number;
  conflicts: number;
};

export type ProductTimeDeploymentRouteDTO = {
  workOrderId: string;
  workOrderCode: string;
  state: ProductTimeDeploymentWorkOrderState;
  status: ProductTimeDeploymentRouteStatus;
  qrUpdated: boolean;
  routeVersionBefore?: number | null;
  routeVersionAfter?: number | null;
  insertedProcesses?: number;
  movedProcesses?: number;
  retiredProcesses?: number;
  updatedTimes?: number;
  historicalReports?: number;
  affectedEmployees?: number;
  supplementObligations?: number;
  systemCoveredQty?: number;
  actualRequiredQty?: number;
  fulfillmentModes?: string[];
  error?: string | null;
};

export type ProductTimeDeploymentPreviewDTO = {
  previewToken: string;
  itemId: string;
  draftProfileId: string;
  fromVersion?: number | null;
  toVersion: number;
  status: 'preview';
  generatedAt: string;
  canPublish: boolean;
  diffs: ProductTimeDeploymentDiffDTO[];
  impact: ProductTimeDeploymentImpactDTO;
  conflicts: ProductTimeDeploymentConflictDTO[];
  routes: ProductTimeDeploymentRouteDTO[];
};

export type ProductTimeDeploymentDTO = {
  id: string;
  itemId: string;
  profileId?: string | null;
  profileVersion: number;
  status: Exclude<ProductTimeDeploymentStatus, 'preview'>;
  createdAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
  impact: ProductTimeDeploymentImpactDTO;
  diffs: ProductTimeDeploymentDiffDTO[];
  conflicts: ProductTimeDeploymentConflictDTO[];
  routes: ProductTimeDeploymentRouteDTO[];
};
export type ProductTimePlanningScope = 'all' | 'current' | 'next' | 'carryover' | 'history';

export type ProductTimePlanningContextDTO = {
  scope: Exclude<ProductTimePlanningScope, 'all'>;
  weekStartDate?: string | null;
  weekEndDate?: string | null;
  orderCount: number;
  batchCount: number;
  totalQuantity: number;
  releasedBatchCount: number;
  frozenBatchCount: number;
  snapshotTotalMilliseconds?: string | null;
};

export type ProductTimePlanningReferenceDTO = {
  planOrderId: string;
  batchId?: string | null;
  batchNo?: number | null;
  quantity: number;
  unitMilliseconds: number;
  weekStartDate?: string | null;
  weekEndDate?: string | null;
  updatedAt: string;
};

export type ProductTimePlanningSummaryDTO = {
  productCount: number;
  orderCount: number;
  batchCount: number;
  totalQuantity: number;
  publishedCount: number;
  missingCount: number;
  quotationMissingCount: number;
  weekStartDate?: string | null;
  weekEndDate?: string | null;
};

export type ProductQuotationTimeDTO = {
  id: string;
  drawingLibraryItemId: string;
  version: number;
  status: 'active' | 'archived';
  unitMilliseconds: number;
  sourceType: 'manual' | 'import' | 'quotation' | 'planning_order';
  sourceRefId?: string | null;
  remark?: string | null;
  effectiveAt: string;
  createdAt: string;
  createdBy?: IssueUserDTO | null;
};

export type ProductProcessTimeEntryDTO = {
  id: string;
  processDefinitionId: string;
  occurrenceKey: string;
  processCode: string;
  processName: string;
  stageGroup: ProcessStageGroup;
  position: number;
  sequenceGroup: number;
  timeBasis: ProcessTimeBasis;
  unitMilliseconds: number;
  actionMilliseconds?: number | null;
  occurrences: number;
  setupMilliseconds: number;
  unitLabel: string;
  reportQuantityBasis: ProcessReportQuantityBasis;
  reportUnitLabel: string;
  countsForEfficiency: boolean;
  isCritical: boolean;
  remark?: string | null;
};

export type ProductTimeProfileDTO = {
  id: string;
  drawingLibraryItemId: string;
  version: number;
  revision: number;
  status: ProductTimeProfileStatus;
  reportingPolicy: ProcessReportingPolicy;
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

export type ProductTimeCopySourceDTO = {
  profileId: string;
  drawingLibraryItemId: string;
  version: number;
  customerName: string;
  customerCode?: string | null;
  specification: string;
  productName?: string | null;
  processCount: number;
  totalMillisecondsPerUnit: number;
  publishedAt?: string | null;
  updatedAt: string;
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
  quotation?: ProductQuotationTimeDTO | null;
  planning?: ProductTimePlanningContextDTO | null;
  planningReference?: ProductTimePlanningReferenceDTO | null;
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
  sequenceGroup: number;
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
  reportQuantityBasis?: ProcessReportQuantityBasis;
  reportUnitLabel?: string;
  countsForEfficiency?: boolean;
  isCritical?: boolean;
  inputQty?: number;
  processedQty?: number;
  goodOutputQty?: number;
  defectOutputQty?: number;
  releasedGoodQty?: number;
  quantityVersion?: number;
  executionCount?: number;
  completionCount?: number;
  completedProcessedQuantity?: number;
  completedGoodQuantity?: number;
  completedDefectQuantity?: number;
  reportedGoodQuantity?: number;
  remainingGoodQuantity?: number | null;
  productTimeProfileId?: string | null;
  productTimeEntryId?: string | null;
  productTimeProfileVersion?: number | null;
  standardSource?: string;
  executionMode?: 'NORMAL' | 'SUPPLEMENTAL_OBLIGATION';
  systemCoveredQty?: number;
  actualRequiredQty?: number | null;
  supplementRemainingQty?: number | null;
  supplementFulfillmentMode?: 'ACTUAL' | 'MIXED' | 'SYSTEM_COVERED' | 'FUTURE_ONLY' | 'RECALL_REQUIRED' | null;
  supplementReleasePolicy?: string | null;
  changeSource?: 'EXISTING' | 'NEW';
  changeTag?: 'ADDED' | 'TIME_CHANGED' | 'ADDED_AND_TIME_CHANGED' | 'NONE';
  changeVersion?: number | null;
  sourceChangeId?: string | null;
  previousStandardMillisecondsPerUnit?: number | null;
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
  reportingPolicy: ProcessReportingPolicy;
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
  currentSteps: WorkOrderProcessStepDTO[];
  nextSteps: WorkOrderProcessStepDTO[];
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
  departmentId?: string | null;
  departmentRecord?: DepartmentRefDTO | null;
  position?: string | null;
  team?: string | null;
  hireDate: string | null;
  mobile: string | null;
  wecomUserId: string | null;
  notificationEnabled: boolean;
  isActive: boolean;
  attendanceEnabled: boolean;
  attainmentEligible: boolean;
  /** 0-10000 basis points. 10000 means a full production-capacity headcount. */
  attainmentFactorBasisPoints: number;
  attainmentStream: AttainmentStream;
  resignedAt: string | null;
  resignationReason: string | null;
  resignationNote: string | null;
  permissionSyncPending?: boolean;
  linkedUser?: EmployeeLinkedUserDTO | null;
  user?: {
    id: string;
    username: string;
    accountStatus?: AccountStatusDTO | null;
    isActive: boolean;
    mustChangePassword?: boolean;
    passwordSetupRequired?: boolean;
    lastLoginAt?: string | null;
    accessGrants?: UserAccessGrantDTO[];
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type RecruitmentDemandStatusDTO =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'RECRUITING'
  | 'INTERVIEWING'
  | 'OFFER'
  | 'CLOSED'
  | 'CANCELLED';

export type RecruitmentPriorityDTO = 'NORMAL' | 'HIGH' | 'URGENT';

export type RecruitmentCandidateStatusDTO =
  | 'SCREENING'
  | 'INTERVIEW'
  | 'OFFER'
  | 'HIRED'
  | 'REJECTED'
  | 'WITHDRAWN';

export type RecruitmentInterviewStatusDTO = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';

export type RecruitmentPersonRefDTO = {
  id: string;
  employeeNo: string;
  name: string;
  department?: string | null;
  position?: string | null;
  team?: string | null;
};

export type RecruitmentInterviewDTO = {
  id: string;
  candidateId: string;
  round: number;
  scheduledAt: string;
  durationMinutes: number;
  interviewer?: RecruitmentPersonRefDTO | null;
  method: string;
  location?: string | null;
  status: RecruitmentInterviewStatusDTO;
  statusText: string;
  result: string;
  resultText: string;
  feedback?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RecruitmentCandidateDTO = {
  id: string;
  sequence: number;
  code: string;
  demandId: string;
  name: string;
  phone?: string | null;
  source: string;
  currentCompany?: string | null;
  currentPosition?: string | null;
  experienceYears?: number | null;
  expectedSalary?: string | null;
  notes?: string | null;
  status: RecruitmentCandidateStatusDTO;
  statusText: string;
  nextActionAt?: string | null;
  rejectionReason?: string | null;
  employee?: RecruitmentPersonRefDTO | null;
  hiredAt?: string | null;
  interviews: RecruitmentInterviewDTO[];
  createdAt: string;
  updatedAt: string;
};

export type RecruitmentActivityDTO = {
  id: string;
  action: string;
  actionText: string;
  fromStatus?: RecruitmentDemandStatusDTO | null;
  toStatus?: RecruitmentDemandStatusDTO | null;
  content?: string | null;
  actor?: IssueUserDTO | null;
  createdAt: string;
};

export type RecruitmentDemandDTO = {
  id: string;
  code: string;
  department: string;
  position: string;
  team?: string | null;
  headcount: number;
  employmentType: string;
  employmentTypeText: string;
  priority: RecruitmentPriorityDTO;
  priorityText: string;
  reason: string;
  requirements?: string | null;
  targetDate?: string | null;
  status: RecruitmentDemandStatusDTO;
  statusText: string;
  requester?: RecruitmentPersonRefDTO | null;
  coordinator?: RecruitmentPersonRefDTO | null;
  candidateCount: number;
  activeCandidateCount: number;
  interviewCount: number;
  hiredCount: number;
  remainingHeadcount: number;
  overdue: boolean;
  version: number;
  approvedAt?: string | null;
  openedAt?: string | null;
  closedAt?: string | null;
  cancelledAt?: string | null;
  candidates: RecruitmentCandidateDTO[];
  activities: RecruitmentActivityDTO[];
  createdAt: string;
  updatedAt: string;
};

export type RecruitmentSummaryDTO = {
  demandCount: number;
  activeDemandCount: number;
  pendingApprovalCount: number;
  plannedHeadcount: number;
  remainingHeadcount: number;
  candidateCount: number;
  interviewCount: number;
  hiredCount: number;
  overdueCount: number;
};

export type AttainmentStream = 'batch' | 'sample' | 'excluded';
export type AttendanceStatus = 'draft' | 'confirmed';
export type AttendanceType = 'normal' | 'partial_leave' | 'leave' | 'absent' | 'rest';
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
  departmentSnapshot?: string | null;
  workDate: string;
  status: AttendanceStatus;
  attendanceType: AttendanceType;
  attainmentFactorBasisPoints: number;
  attainmentStream: AttainmentStream;
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
  | 'personal'
  | 'training'
  | 'drawing_technical'
  | 'process'
  | 'quality'
  | 'incoming_material'
  | 'equipment_tooling'
  | 'planning_coordination'
  | 'system_other'
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
  subcategory?: string | null;
  title: string;
  reason?: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMilliseconds: number;
  approvedDurationMilliseconds?: number | null;
  affectedPersonMilliseconds: number;
  approvedPersonMilliseconds: number;
  affectedQuantity?: number | null;
  employeeExempt: boolean;
  qualityStatus: AbnormalTimeQualityStatus;
  qualityNote?: string | null;
  qualityConfirmedBy?: { id: string; username: string; displayName: string } | null;
  qualityConfirmedAt?: string | null;
  resolutionStatus: AbnormalTimeResolutionStatus;
  responsibilityDepartment?: string | null;
  responsibilityObject?: string | null;
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
  source: 'BACKOFFICE' | 'FIELD_REPORT' | string;
  reportedByEmployee?: EmployeeDTO | null;
  version: number;
  allocations: AbnormalTimeAllocationDTO[];
  createdAt: string;
  updatedAt: string;
};

export type ProcessExecutionContextDTO = {
  stepId: string;
  processName: string;
  processCode: string;
  targetQuantity: number;
  reportedGoodQuantity: number;
  remainingGoodQuantity: number;
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

export type ProcessLaborPoolStatus = 'OPEN' | 'PARTIAL' | 'EXHAUSTED' | 'LOCKED' | 'VOIDED';
export type ProcessLaborClaimStatus = 'ACTIVE' | 'VOIDED' | 'REVERSAL';

export type ProcessLaborClaimDTO = {
  id: string;
  poolId: string;
  employee: EmployeeDTO;
  quantity: number;
  standardLaborMilliseconds: number;
  workDate: string;
  status: ProcessLaborClaimStatus;
  source: string;
  claimedBy?: { id: string; username: string; displayName: string } | null;
  claimedAt: string;
  voidedAt?: string | null;
  voidedBy?: { id: string; username: string; displayName: string } | null;
  voidReason?: string | null;
  reversalOfId?: string | null;
  createdAt: string;
};

export type ProcessLaborPoolDTO = {
  id: string;
  completionId: string;
  workOrderId: string;
  stepId: string;
  workDate: string;
  eligibleQty: number;
  claimedQty: number;
  remainingQty: number;
  status: ProcessLaborPoolStatus;
  pendingStandard: boolean;
  timeBasis?: 'per_unit' | 'per_batch' | null;
  unitLabel: string;
  suggestedEmployees: EmployeeDTO[];
  workStartedAt?: string | null;
  workEndedAt?: string | null;
  team?: string | null;
  workstation?: string | null;
  completionRemark?: string | null;
  version: number;
  standardMillisecondsPerUnit: number;
  setupMilliseconds: number;
  unitsPerProduct: number;
  totalStandardLaborMilliseconds: number;
  claimedStandardLaborMilliseconds: number;
  remainingStandardLaborMilliseconds: number;
  countsForEfficiency: boolean;
  standardSource: string;
  productTimeProfileVersion?: number | null;
  createdAt: string;
  updatedAt: string;
  lockedAt?: string | null;
  workOrder: {
    id: string;
    code: string;
    customerName?: string | null;
    specification?: string | null;
    productName: string;
  };
  step: {
    id: string;
    processCode: string;
    processName: string;
    stageGroup: string;
  };
  claims: ProcessLaborClaimDTO[];
};

export type ProcessLaborPoolSummaryDTO = {
  poolCount: number;
  openPoolCount: number;
  pendingStandardPoolCount: number;
  pendingStandardQty: number;
  eligibleQty: number;
  claimedQty: number;
  remainingQty: number;
  totalStandardLaborMilliseconds: number;
  claimedStandardLaborMilliseconds: number;
  remainingStandardLaborMilliseconds: number;
};

export type ProcessLaborAccessDTO = {
  role: LaborAccessRoleDTO;
  selfEmployeeId: string | null;
  team: string | null;
  canClaim: boolean;
  canAssignOthers: boolean;
  canVoid: boolean;
  canResolveStandard: boolean;
  blockedReason: string | null;
};

export type EmployeeLaborClaimDetailDTO = {
  id: string;
  poolId: string;
  employee: EmployeeDTO;
  workOrderId: string;
  workOrderCode: string;
  customerName?: string | null;
  specification?: string | null;
  productName: string;
  processCode: string;
  processName: string;
  workDate: string;
  quantity: number;
  unitLabel: string;
  standardLaborMilliseconds: number;
  claimedAt: string;
  reportedAt: string;
  attendanceMatched: boolean;
  standardSource: string;
  productTimeProfileVersion?: number | null;
  corrected?: boolean;
};

export type ReportCenterPeriodDTO = 'today' | 'week' | 'month' | 'custom';
export type ReportCenterModeDTO = 'all' | 'mass' | 'sample';
export type ReportCenterRiskDTO = 'high' | 'medium' | 'low';
export type ReportCenterFocusStatusDTO = 'completed' | 'in_progress' | 'pending' | 'overdue' | 'review';

export type ReportCenterFocusItemDTO = {
  entityType: 'workOrder' | 'sampleTask';
  id: string;
  code: string;
  customerName: string;
  productName: string;
  specification: string;
  plannedQty: number | null;
  completedQty: number | null;
  unitLabel: string;
  progressBasisPoints: number | null;
  status: ReportCenterFocusStatusDTO;
  statusLabel: string;
  currentProcess: string | null;
  nextProcess: string | null;
  owner: string | null;
  dueAt: string | null;
  dueSoon?: boolean;
  startedAt?: string | null;
  completedAt?: string | null;
  submittedItemCount?: number;
  pendingReviewCount?: number;
  reviewedItemCount?: number;
  publishedItemCount?: number;
  risk: ReportCenterRiskDTO;
  riskLabel: string;
  missingData: string[];
};

export type ReportCenterOverviewDTO = {
  period: ReportCenterPeriodDTO;
  date: string;
  mode: ReportCenterModeDTO;
  customer: string;
  rangeStart: string;
  rangeEnd: string;
  generatedAt: string;
  customers: string[];
  quantityScope: {
    label: string;
    unitLabel: string;
    note: string;
  };
  summary: {
    plannedQty: number;
    completedQty: number;
    completionBasisPoints: number | null;
    completedOrders: number;
    activeOrders: number;
    pendingOrders: number;
    overdueOrders: number;
    dueSoonOrders: number;
    processReportedGoodQty: number;
    processReportedDefectQty: number;
    processDefectBasisPoints: number | null;
    dataCompletenessBasisPoints: number | null;
    missingRouteOrders: number;
    missingStandardOrders: number;
    missingDrawingOrders: number;
    materialRuleUnpublishedOrders: number;
    pendingSampleReviewItems: number;
  };
  dailyTrend: Array<{
    date: string;
    label: string;
    plannedQty: number;
    completedQty: number;
  }>;
  statusDistribution: Array<{
    key: ReportCenterFocusStatusDTO;
    label: string;
    count: number;
    basisPoints: number;
  }>;
  processBottlenecks: Array<{
    processCode: string;
    processName: string;
    pendingQty: number;
    workOrderCount: number;
    overdueWorkOrderCount: number;
  }>;
  completeness: Array<{
    key: 'route' | 'standard' | 'drawing' | 'material' | 'sample_review';
    label: string;
    count: number;
    note: string;
    route: string;
  }>;
  sample: {
    taskCount: number;
    activeCount: number;
    completedCount: number;
    taskAttainmentBasisPoints: number | null;
    overdueCount: number;
    pendingReviewCount: number;
    publishedItemCount: number;
    reviewedItemCount: number;
    reviewBasisPoints: number | null;
  };
  focusItems: ReportCenterFocusItemDTO[];
};

export type ReportOperationsDayStatusDTO = 'not_employed' | 'missing' | 'draft' | 'confirmed' | 'rest';
export type ReportAttendancePublicationStateDTO = 'future' | 'in_progress' | 'incomplete' | 'finalized' | 'no_roster' | 'weekly_rest' | 'holiday';
export type ReportAttendanceCalendarDayTypeDTO = 'workday' | 'weekly_rest' | 'holiday' | 'temporary_workday';
export type ReportAttendanceCalendarOverrideTypeDTO = 'default' | 'holiday' | 'temporary_workday' | null;

export type ReportOperationsLaborRowDTO = {
  team: string;
  employeeCount: number;
  attendancePeople: number;
  confirmedRecords: number;
  plannedMilliseconds: number;
  scheduledMilliseconds: number;
  plannedOvertimeMilliseconds: number;
  recognizedOvertimeMilliseconds: number;
  actualOvertimeMilliseconds: number;
  leaveDeductionMilliseconds: number;
  netExpectedMilliseconds: number;
  attendanceMilliseconds: number;
  extraAttendanceMilliseconds: number;
  leaveMilliseconds: number;
  exemptAbnormalMilliseconds: number;
  actualLaborMilliseconds: number;
  standardLaborMilliseconds: number;
  unmatchedStandardLaborMilliseconds: number;
  overlapMilliseconds: number;
  unexplainedMilliseconds: number;
  attainmentCapacityMilliseconds: number;
  attendanceRawBasisPoints: number | null;
  attendanceBasisPoints: number | null;
  utilizationBasisPoints: number | null;
  efficiencyBasisPoints: number | null;
  attainmentBasisPoints: number | null;
};

export type ReportOperationsEmployeeDayDTO = {
  date: string;
  status: ReportOperationsDayStatusDTO;
  attendanceRequired: boolean;
  attendanceType: AttendanceType | null;
  plannedMilliseconds: number;
  scheduledMilliseconds: number;
  plannedOvertimeMilliseconds: number;
  recognizedOvertimeMilliseconds: number;
  actualOvertimeMilliseconds: number;
  leaveDeductionMilliseconds: number;
  netExpectedMilliseconds: number;
  attendanceMilliseconds: number;
  extraAttendanceMilliseconds: number;
  leaveMilliseconds: number;
  actualLaborMilliseconds: number;
  standardLaborMilliseconds: number;
  unmatchedStandardLaborMilliseconds: number;
  exemptAbnormalMilliseconds: number;
  overlapMilliseconds: number;
  unexplainedMilliseconds: number;
  attainmentCapacityMilliseconds: number;
  attendanceRawBasisPoints: number | null;
  attendanceBasisPoints: number | null;
  utilizationBasisPoints: number | null;
  efficiencyBasisPoints: number | null;
  attainmentBasisPoints: number | null;
  overtimeSource: 'confirmed_plan' | 'confirmed_attendance' | 'attendance_fallback' | 'none';
  attainmentEligible: boolean;
  attainmentFactorBasisPoints: number;
  attainmentStream: AttainmentStream;
};

export type ReportOperationsEmployeeRowDTO = {
  employee: EmployeeDTO;
  team: string;
  position: string;
  plannedMilliseconds: number;
  scheduledMilliseconds: number;
  plannedOvertimeMilliseconds: number;
  recognizedOvertimeMilliseconds: number;
  actualOvertimeMilliseconds: number;
  leaveDeductionMilliseconds: number;
  netExpectedMilliseconds: number;
  attendanceMilliseconds: number;
  extraAttendanceMilliseconds: number;
  leaveMilliseconds: number;
  actualLaborMilliseconds: number;
  standardLaborMilliseconds: number;
  unmatchedStandardLaborMilliseconds: number;
  exemptAbnormalMilliseconds: number;
  overlapMilliseconds: number;
  unexplainedMilliseconds: number;
  attainmentCapacityMilliseconds: number;
  attendanceRawBasisPoints: number | null;
  attendanceBasisPoints: number | null;
  utilizationBasisPoints: number | null;
  efficiencyBasisPoints: number | null;
  attainmentBasisPoints: number | null;
  confirmedDays: number;
  draftDays: number;
  missingDays: number;
  attainmentEligible: boolean;
  attainmentFactorBasisPoints: number;
  attainmentStream: AttainmentStream;
  days: ReportOperationsEmployeeDayDTO[];
};

export type ReportOperationsDTO = {
  month: string;
  period: ReportCenterPeriodDTO;
  date: string;
  workforceScope: 'PRODUCTION';
  workforceLabel: string;
  rangeStart: string;
  rangeEnd: string;
  cutoffAt: string;
  generatedAt: string;
  targetBasisPoints: number;
  dates: Array<{
    date: string;
    day: number;
    weekday: string;
    isWeekend: boolean;
    isFuture: boolean;
    calendarDayType: ReportAttendanceCalendarDayTypeDTO;
    calendarOverrideType: ReportAttendanceCalendarOverrideTypeDTO;
    calendarLabel: string | null;
    calendarRemark: string | null;
    isWorkday: boolean;
  }>;
  summary: {
    employeeCount: number;
    teamCount: number;
    plannedMilliseconds: number;
    scheduledMilliseconds: number;
    plannedOvertimeMilliseconds: number;
    recognizedOvertimeMilliseconds: number;
    actualOvertimeMilliseconds: number;
    leaveDeductionMilliseconds: number;
    netExpectedMilliseconds: number;
    attendanceMilliseconds: number;
    extraAttendanceMilliseconds: number;
    actualLaborMilliseconds: number;
    standardLaborMilliseconds: number;
    unmatchedStandardLaborMilliseconds: number;
    exemptAbnormalMilliseconds: number;
    overlapMilliseconds: number;
    unexplainedMilliseconds: number;
    attainmentCapacityMilliseconds: number;
    attendanceRawBasisPoints: number | null;
    attendanceBasisPoints: number | null;
    utilizationBasisPoints: number | null;
    efficiencyBasisPoints: number | null;
    attainmentBasisPoints: number | null;
    confirmedAttendanceRecords: number;
    draftAttendanceRecords: number;
    missingAttendanceRecords: number;
    dataCoverageBasisPoints: number | null;
    plannedBatches: number;
    scheduledBatches: number;
    futureBatches: number;
    completedBatches: number;
    batchCompletionBasisPoints: number | null;
    plannedQuantity: number;
    scheduledQuantity: number;
    futureQuantity: number;
    completedQuantity: number;
    quantityCompletionBasisPoints: number | null;
  };
  attendanceScore: {
    workforceLabel: string;
    requiredRecords: number;
    resolvedRecords: number;
    draftRecords: number;
    missingRecords: number;
    dataCoverageBasisPoints: number | null;
    finalizedDays: number;
    incompleteDays: number;
    inProgressDays: number;
    weeklyRestDays: number;
    holidayDays: number;
    lastFinalizedDate: string | null;
    netExpectedMilliseconds: number;
    attendanceMilliseconds: number;
    shortfallMilliseconds: number;
    extraAttendanceMilliseconds: number;
    actualOvertimeMilliseconds: number;
    leaveDeductionMilliseconds: number;
    attendanceRawBasisPoints: number | null;
    attendanceBasisPoints: number | null;
  };
  teamMonthly: ReportOperationsLaborRowDTO[];
  teamDaily: Array<ReportOperationsLaborRowDTO & { date: string }>;
  weeklyPlan: Array<{
    key: string;
    label: string;
    startDate: string;
    endDate: string;
    isFutureWeek: boolean;
    scheduledBatches: number;
    plannedBatches: number;
    futureBatches: number;
    completedBatches: number;
    scheduledQuantity: number;
    plannedQuantity: number;
    futureQuantity: number;
    completedQuantity: number;
    batchCompletionBasisPoints: number | null;
    quantityCompletionBasisPoints: number | null;
  }>;
  dailyAttendance: Array<{
    date: string;
    calendarDayType: ReportAttendanceCalendarDayTypeDTO;
    calendarOverrideType: ReportAttendanceCalendarOverrideTypeDTO;
    calendarLabel: string | null;
    calendarRemark: string | null;
    isWorkday: boolean;
    scheduledPeople: number;
    plannedPeople: number;
    attendancePeople: number;
    leavePeople: number;
    fullLeavePeople: number;
    absentPeople: number;
    restPeople: number;
    requiredRecords: number;
    resolvedRecords: number;
    confirmedRecords: number;
    draftRecords: number;
    missingRecords: number;
    dataCoverageBasisPoints: number | null;
    publicationState: ReportAttendancePublicationStateDTO;
    isFinalized: boolean;
    plannedMilliseconds: number;
    scheduledMilliseconds: number;
    plannedOvertimeMilliseconds: number;
    recognizedOvertimeMilliseconds: number;
    actualOvertimeMilliseconds: number;
    leaveDeductionMilliseconds: number;
    netExpectedMilliseconds: number;
    attendanceMilliseconds: number;
    extraAttendanceMilliseconds: number;
    attendanceRawBasisPoints: number | null;
    attendanceBasisPoints: number | null;
    hoursBasisPoints: number | null;
    planOvertimeRecords: number;
    attendanceFallbackRecords: number;
  }>;
  employeeMatrix: ReportOperationsEmployeeRowDTO[];
  dailyAttainmentAverage: Array<{
    date: string;
    employeeCount: number;
    attainmentBasisPoints: number | null;
  }>;
  dataNotes: string[];
};

export type EmployeeAttainmentRowDTO = {
  employee: EmployeeDTO;
  attainmentEligible: boolean;
  attainmentFactorBasisPoints: number;
  attainmentStream: AttainmentStream;
  standardLaborMilliseconds: number;
  legacyExecutionStandardLaborMilliseconds: number;
  claimedStandardLaborMilliseconds: number;
  unmatchedStandardLaborMilliseconds: number;
  actualLaborMilliseconds: number;
  attendanceMilliseconds: number;
  exemptAbnormalMilliseconds: number;
  effectiveProductionMilliseconds: number;
  attainmentCapacityMilliseconds: number;
  unexplainedMilliseconds: number;
  attendanceConfirmedDays: number;
  attendanceMissingDays: number;
  attendanceMissing: boolean;
  attainmentBasisPoints: number | null;
  processEfficiencyBasisPoints: number;
  rawAttendanceOutputBasisPoints: number | null;
  coverageBasisPoints: number | null;
  goodQty: number;
  scrapQty: number;
  reworkQty: number;
  executionCount: number;
  claimCount: number;
  claimQuantity: number;
  days: EmployeeAttainmentDayDTO[];
  details: ProcessExecutionDTO[];
  claimDetails: EmployeeLaborClaimDetailDTO[];
};

export type EmployeeAttainmentDayDTO = {
  date: string;
  attendanceStatus: 'missing' | 'draft' | 'confirmed';
  attendanceType: AttendanceType | null;
  scheduledMilliseconds: number;
  recognizedOvertimeMilliseconds: number;
  actualOvertimeMilliseconds: number;
  leaveDeductionMilliseconds: number;
  netExpectedMilliseconds: number;
  attendanceMilliseconds: number;
  extraAttendanceMilliseconds: number;
  actualLaborMilliseconds: number;
  standardLaborMilliseconds: number;
  claimedStandardLaborMilliseconds: number;
  exemptAbnormalMilliseconds: number;
  unexplainedMilliseconds: number;
  overlapMilliseconds: number;
  attendanceBasisPoints: number | null;
  utilizationBasisPoints: number | null;
  efficiencyBasisPoints: number | null;
  targetAttainmentBasisPoints: number | null;
  attainmentCapacityMilliseconds: number;
  overtimeSource: 'confirmed_plan' | 'confirmed_attendance' | 'attendance_fallback' | 'none';
  includedInAttainment: boolean;
  exclusionReason: 'leave' | 'rest' | 'absent' | 'missing_attendance' | 'zero_attendance' | 'excluded_stream' | null;
};

export type ReportCompletedBatchStatusDTO =
  | 'completed_on_time'
  | 'completed_late'
  | 'overdue'
  | 'in_progress'
  | 'pending'
  | 'unreleased'
  | 'route_missing';

export type ReportCompletedBatchRowDTO = {
  id: string;
  sourceOrderNo: string;
  sourceLineNo: number;
  batchNo: number;
  batchLabel: string;
  workOrderId: string | null;
  workOrderCode: string | null;
  customerName: string;
  productName: string;
  specification: string;
  quantity: number;
  completedQuantity: number;
  quantityBasisPoints: number | null;
  plannedCompletionDate: string;
  actualCompletionAt: string | null;
  status: ReportCompletedBatchStatusDTO;
  statusLabel: string;
  overdue: boolean;
  currentProcess: string | null;
  owner: string | null;
  releaseState: string;
};

export type ReportCompletedBatchesDTO = {
  period: ReportCenterPeriodDTO;
  date: string;
  rangeStart: string;
  rangeEnd: string;
  cutoffAt: string;
  generatedAt: string;
  customer: string;
  keyword: string;
  customers: string[];
  summary: {
    dueBatches: number;
    completedBatches: number;
    onTimeCompletedBatches: number;
    lateCompletedBatches: number;
    overdueBatches: number;
    inProgressBatches: number;
    pendingBatches: number;
    unreleasedBatches: number;
    routeMissingBatches: number;
    plannedQuantity: number;
    completedQuantity: number;
    batchCompletionBasisPoints: number | null;
    onTimeAttainmentBasisPoints: number | null;
    quantityAttainmentBasisPoints: number | null;
  };
  page: number;
  pageSize: number;
  total: number;
  rows: ReportCompletedBatchRowDTO[];
};

export type EmployeeAttainmentReportDTO = {
  period: ReportCenterPeriodDTO;
  date: string;
  workforceScope?: 'PRODUCTION';
  workforceLabel?: string;
  rangeStart: string;
  rangeEnd: string;
  summary: {
    employeeCount: number;
    executionCount: number;
    claimCount: number;
    claimQuantity: number;
    standardLaborMilliseconds: number;
    legacyExecutionStandardLaborMilliseconds: number;
    claimedStandardLaborMilliseconds: number;
    unmatchedStandardLaborMilliseconds: number;
    actualLaborMilliseconds: number;
    attendanceMilliseconds: number;
    exemptAbnormalMilliseconds: number;
    effectiveProductionMilliseconds: number;
    attainmentCapacityMilliseconds: number;
    unexplainedMilliseconds: number;
    attendanceConfirmedDays: number;
    attendanceMissingDays: number;
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
  period: ReportCenterPeriodDTO;
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
    approvedPersonMilliseconds: number;
    confirmedExemptPersonMilliseconds: number;
  };
  categories: Array<{
    category: AbnormalTimeCategory;
    categoryLabel: string;
    eventCount: number;
    incidentMilliseconds: number;
    affectedPersonMilliseconds: number;
    approvedPersonMilliseconds: number;
  }>;
  events: AbnormalTimeEventDTO[];
};

export type WorkflowProcessStatus = 'waiting' | 'processing' | 'verifying' | 'closed';
export type WorkflowEntityType = 'issue' | 'change' | 'production';
export type WorkflowWeekScope = 'history' | 'current' | 'next' | 'afterNext';

export type ProductionWeekNavigationItemDTO = {
  weekStartDate: string;
  weekEndDate: string;
  count: number;
};

export type WorkflowWeekNavigationDTO = {
  current: ProductionWeekNavigationItemDTO;
  next: ProductionWeekNavigationItemDTO;
  afterNext: ProductionWeekNavigationItemDTO;
  carryoverCount: number;
  history: ProductionWeekNavigationItemDTO[];
};

export type ProductionWeekReconciliationIssueCode =
  | 'plan_missing_work_order'
  | 'work_order_week_mismatch'
  | 'work_order_missing_plan'
  | 'workflow_missing_work_order';

export type ProductionWeekReconciliationIssueDTO = {
  code: ProductionWeekReconciliationIssueCode;
  label: string;
  count: number;
  items: Array<{
    id: string;
    code: string;
    detail: string;
  }>;
};

export type ProductionWeekReconciliationDTO = {
  weekStartDate: string;
  weekEndDate: string;
  planBatchCount: number;
  productionWorkOrderCount: number;
  workflowInstanceCount: number;
  alignedWorkOrderCount: number;
  aligned: boolean;
  differenceCount: number;
  issues: ProductionWeekReconciliationIssueDTO[];
};

export type WorkflowStepDTO = {
  key: string;
  label: string;
  state: 'done' | 'current' | 'pending';
  sequenceGroup?: number;
  status?: ProcessStepStatus;
  stageGroup?: ProcessStageGroup;
  unitLabel?: string | null;
  reportQuantityBasis?: ProcessReportQuantityBasis;
  reportUnitLabel?: string | null;
  standardMillisecondsPerUnit?: number | null;
  executionMode?: 'NORMAL' | 'SUPPLEMENTAL_OBLIGATION';
  isCritical?: boolean;
  changeSource?: 'EXISTING' | 'NEW';
  changeTag?: 'ADDED' | 'TIME_CHANGED' | 'ADDED_AND_TIME_CHANGED' | 'NONE';
  changeVersion?: number | null;
  sourceChangeId?: string | null;
  previousStandardMillisecondsPerUnit?: number | null;
  inputQuantity?: number;
  processedQuantity?: number;
  reportedGoodQuantity?: number;
  defectQuantity?: number;
  releasedGoodQuantity?: number;
  remainingProcessQuantity?: number;
  systemCoveredQuantity?: number;
  actualRequiredQuantity?: number;
  supplementRemainingQuantity?: number | null;
  supplementFulfillmentMode?: 'ACTUAL' | 'MIXED' | 'SYSTEM_COVERED' | 'FUTURE_ONLY' | 'RECALL_REQUIRED' | null;
  supplementReleasePolicy?: string | null;
  remainingGoodQuantity?: number | null;
  laborEligibleQuantity?: number;
  laborClaimedQuantity?: number;
  laborRemainingQuantity?: number;
  laborClaimantNames?: string[];
  hasLaborPool?: boolean;
  laborPoolId?: string | null;
  laborWorkDate?: string | null;
  laborPendingStandard?: boolean;
  startedAt?: string | null;
  completedAt?: string | null;
  remark?: string | null;
  productRemark?: string | null;
  latestEmployeeName?: string | null;
  latestReportedAt?: string | null;
  completionRecords?: Array<{
    id: string;
    workDate: string;
    completedAt: string;
    processedQty: number;
    goodQty: number;
    defectQty: number;
    reportedUnitQty: number;
    reportedGoodUnitQty: number;
    reportedDefectUnitQty: number;
    reportQuantityBasis: ProcessReportQuantityBasis;
    reportUnitLabel: string;
    reportMode: 'sequential' | 'advance';
    coverageStatus: 'pending' | 'partial' | 'covered';
    coveredQty: number;
    pendingCoverageQty: number;
    participantNames: string[];
    laborPoolId: string | null;
    laborClaimedQty: number;
    standardMillisecondsPerUnit: number | null;
    standardSource: string;
  }>;
};

export type WorkflowActivityDTO = {
  id: string;
  action: string;
  label: string;
  actor?: string | null;
  createdAt: string;
};

export type ProductTimeRouteLinkState =
  | 'linked'
  | 'available'
  | 'upgrade_available'
  | 'missing_profile'
  | 'locked';

export type HistoricalRouteRepairDTO = {
  suggestedStepKey: string;
  legacyStage: string;
  targetQuantity: number;
  transferredQuantity: number;
  completedQuantity: number;
};

export type WorkflowItemDTO = {
  id: string;
  entityId: string;
  entityType: WorkflowEntityType;
  batchId?: string | null;
  workOrderId?: string | null;
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
  quantity?: number | null;
  weekStartDate?: string | null;
  weekEndDate?: string | null;
  carryover?: {
    id: string;
    sourceWeekStartDate: string;
    targetWeekStartDate: string;
    originalWeekStartDate: string;
    inclusionType: string;
  } | null;
  processRouteId?: string | null;
  routeVersion?: number | null;
  routeStatus?: ProcessRouteStatus | null;
  routeSource?: string | null;
  productTimeProfileVersion?: number | null;
  availableProductTimeProfileVersion?: number | null;
  availableProductTimeProcessCount?: number | null;
  productTimeRouteLinkState?: ProductTimeRouteLinkState | null;
  canApplyProductTimeProfile?: boolean;
  routeDisplayMode?: 'actual' | 'published_reference' | 'fallback';
  historicalRouteRepair?: HistoricalRouteRepairDTO | null;
  productRemark?: string | null;
  orderRemark?: string | null;
  drawingLibraryItemId?: string | null;
  preparationSteps?: WorkflowStepDTO[];
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

export type TerminalToolingBladePositionDTO = 'UPPER_OUTER' | 'UPPER_INNER' | 'LOWER_OUTER' | 'LOWER_INNER';
export type TerminalToolingSetupStatusDTO = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export type TerminalToolingSupplyDTO = {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierSku?: string | null;
  productUrl?: string | null;
  remark?: string | null;
};

export type TerminalToolingTerminalDTO = {
  id: string;
  specification: string;
  manufacturer?: string | null;
  aliases: string[];
  wireRange?: string | null;
  material?: string | null;
  plating?: string | null;
  remark?: string | null;
  isActive: boolean;
  lockVersion: number;
  setupCount: number;
  publishedSetupCount: number;
  supplierLinks: TerminalToolingSupplyDTO[];
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TerminalToolingBladeDTO = {
  id: string;
  model: string;
  manufacturer?: string | null;
  compatiblePositions: TerminalToolingBladePositionDTO[];
  specification?: string | null;
  dimensionA?: string | null;
  dimensionB?: string | null;
  dimensionUnit?: string | null;
  material?: string | null;
  hardness?: string | null;
  remark?: string | null;
  isActive: boolean;
  lockVersion: number;
  usageCount: number;
  supplierLinks: TerminalToolingSupplyDTO[];
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TerminalToolingSetupPositionDTO = {
  id: string;
  position: TerminalToolingBladePositionDTO;
  bladeId: string;
  remark?: string | null;
  blade: TerminalToolingBladeDTO;
};

export type TerminalToolingSetupDTO = {
  id: string;
  terminalId: string;
  terminal: Pick<TerminalToolingTerminalDTO, 'id' | 'specification' | 'manufacturer' | 'isActive'>;
  name?: string | null;
  wireRange?: string | null;
  equipment?: string | null;
  mold?: string | null;
  contextKey: string;
  version: number;
  status: TerminalToolingSetupStatusDTO;
  remark?: string | null;
  lockVersion: number;
  publishedAt?: string | null;
  publishedBy?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
  positions: TerminalToolingSetupPositionDTO[];
  tags: string[];
};

export type TerminalToolingStatsDTO = {
  terminalCount: number;
  bladeCount: number;
  publishedSetupCount: number;
  draftSetupCount: number;
  incompleteSetupCount: number;
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

export type SkillCategoryDTO = 'PROCESS' | 'QUALITY' | 'WAREHOUSE' | 'SAFETY' | 'MANAGEMENT' | 'GENERAL';
export type SkillAssessmentStatusDTO = 'DRAFT' | 'PENDING_REVIEW' | 'RETURNED' | 'APPROVED' | 'CANCELLED';
export type SkillAssessmentResultDTO = 'PENDING' | 'PASSED' | 'FAILED';

export type SkillDefinitionDTO = {
  id: string;
  code: string;
  name: string;
  category: SkillCategoryDTO;
  description?: string | null;
  sourceProcessDefinitionId?: string | null;
  isCore: boolean;
  isSubsidyEligible: boolean;
  subsidyMinimumLevel?: number | null;
  isCritical: boolean;
  defaultValidityMonths: number;
  isActive: boolean;
  sortOrder: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type PositionSkillRequirementDTO = {
  id: string;
  scopeKey: string;
  department: string;
  position: string;
  team: string;
  skillId: string;
  targetLevel: number;
  isRequired: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type EmployeeSkillCertificationDTO = {
  id: string;
  employeeId: string;
  skillId: string;
  level: number;
  status: string;
  source: 'ASSESSMENT' | 'LEGACY_ENTRY';
  evidenceType?: 'LONG_TERM_PRACTICE' | 'SUPERVISOR_CONFIRMATION' | 'HISTORICAL_CERTIFICATE' | 'TRAINING_RECORD' | 'OTHER' | null;
  score?: number | null;
  assessmentId?: string | null;
  assessorId?: string | null;
  reviewerId?: string | null;
  effectiveFrom: string;
  expiresAt?: string | null;
  requiresReassessment: boolean;
  note?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type SkillRewardRuleDTO = {
  id: string;
  code: string;
  jobName: string;
  jobKeyword: string;
  skillId: string;
  minimumLevel: number;
  rewardName: string;
  rewardDescription?: string | null;
  isActive: boolean;
  sortOrder: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type SkillAssessmentItemDTO = {
  id: string;
  templateId: string;
  code: string;
  section: string;
  title: string;
  description?: string | null;
  weight: number;
  maxScore: number;
  isRequired: boolean;
  isCritical: boolean;
  sortOrder: number;
};

export type SkillAssessmentTemplateDTO = {
  id: string;
  code: string;
  name: string;
  department: string;
  position: string;
  team: string;
  skillId?: string | null;
  version: number;
  status: string;
  passScore: number;
  targetLevel: number;
  validityMonths: number;
  instructions?: string | null;
  createdAt: string;
  updatedAt: string;
  items: SkillAssessmentItemDTO[];
};

export type SkillAssessmentAnswerDTO = {
  id: string;
  assessmentId: string;
  itemId: string;
  score?: number | null;
  passed?: boolean | null;
  comment?: string | null;
};

export type SkillAssessmentActivityDTO = {
  id: string;
  action: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  content?: string | null;
  actorId?: string | null;
  createdAt: string;
};

export type SkillAssessmentDTO = {
  id: string;
  code: string;
  employeeId: string;
  skillId: string;
  templateId: string;
  templateVersion: number;
  assessorId: string;
  reviewerId: string;
  status: SkillAssessmentStatusDTO;
  result: SkillAssessmentResultDTO;
  totalScore?: number | null;
  proposedLevel: number;
  reviewComment?: string | null;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  validFrom?: string | null;
  expiresAt?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  employee: EmployeeDTO;
  skill: SkillDefinitionDTO;
  template: SkillAssessmentTemplateDTO;
  assessor?: EmployeeDTO | null;
  reviewer?: EmployeeDTO | null;
  answers: SkillAssessmentAnswerDTO[];
  activities: SkillAssessmentActivityDTO[];
};

export type SkillWorkbenchSummaryDTO = {
  skillCount: number;
  requiredPositionCount: number;
  certifiedEmployeeCount: number;
  formalCertifiedEmployeeCount: number;
  legacyProfileEmployeeCount: number;
  pendingReviewCount: number;
  expiringCertificationCount: number;
  coverageBasisPoints: number | null;
};
