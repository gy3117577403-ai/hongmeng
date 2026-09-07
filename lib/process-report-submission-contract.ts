export type ReportingSourceInput = { kind: 'NATIVE' | 'WIP'; lotId?: string; allocationId?: string };
export type ReportSubmissionDto = {
  id: string; status: 'PENDING' | 'COMPLETED' | 'CANCELLED'; version: number;
  reasonCode: string; reasonLabel: string; lastError: string | null;
  workOrderId: string; workOrderCode: string; productName: string; specification: string | null;
  routeId: string; stepId: string; processName: string; workDate: string;
  createdById: string; createdByName: string; assigneeNames: string[]; assigneeUserIds: string[];
  sourceKind: string; sourceLotId: string | null; sourceAllocationId: string | null;
  processedQty: number; defectQty: number; reportedUnitQty: number; reportedDefectUnitQty: number;
  reportQuantityBasis: string; reportUnitLabel: string; employeeNames: string[];
  completionId: string | null; result: unknown; createdAt: string; completedAt: string | null;
  canResolve: boolean; canCancel: boolean;
};
export type ReportRecoverySourceOption = {
  key: string; lotId: string; lotNo: string; allocationId: string | null;
  targetWeekStartDate: string | null; targetWeekEndDate: string | null;
  remainingQty: number; version: number;
  action: 'USE_ALLOCATION' | 'RESCHEDULE_REMAINING' | 'SCHEDULE_REMAINING' | 'FUTURE_CONFIRMATION' | 'HISTORICAL_CONFIRMATION';
  label: string;
};
export type ReportSubmissionPreview = {
  submission: ReportSubmissionDto;
  canResolve: boolean;
  actions: Array<{ code: 'REPAIR_STANDARD' | 'RESOLVE_STANDARD' | 'CONFIRM_SOURCE'; label: string }>;
  sourceOptions: ReportRecoverySourceOption[];
  quantityMappingRequired: boolean;
  standardPreview: {
    current: { reportQuantityBasis: string; reportUnitLabel: string; unitsPerProduct: number; timeBasis: string | null; standardMillisecondsPerUnit: number | null };
    published: { reportQuantityBasis: string; reportUnitLabel: string; unitsPerProduct: number; timeBasis: string | null; standardMillisecondsPerUnit: number | null; setupMilliseconds: number; countsForEfficiency: boolean; productTimeProfileVersion?: number | null; productTimeEntryId?: string | null } | null;
  };
  blockers: string[];
  routeVersion: number | null;
};
export type ReportSubmissionResolutionInput = {
  expectedVersion: number;
  expectedRouteVersion?: number;
  expectedProfileVersion?: number | null;
  expectedEntryId?: string | null;
  sourceKey?: string;
  sourceVersion?: number;
  confirmQuantityMapping?: boolean;
  processedQty?: number;
  defectQty?: number;
  reportedUnitQty?: number;
  reportedDefectUnitQty?: number;
  confirmAdvanceSchedule?: boolean;
  confirmHistoricalWork?: boolean;
  standard?: { timeBasis: 'per_batch' | 'per_unit'; standardMillisecondsPerUnit: number; setupMilliseconds?: number; unitsPerProduct?: number; countsForEfficiency?: boolean };
};
