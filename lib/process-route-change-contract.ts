export type ProcessRouteChangeStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'ACTIVATING'
  | 'ACTIVE'
  | 'FAILED';

export type ProcessRouteChangeReviewAction = 'approve' | 'reject';

export type ProcessDefinitionBindingCandidate = {
  id: string;
  code?: string | null;
  name: string;
};

export type ProcessRouteChangeDefinitionBinding = {
  selectedId: string;
  exactMatches: ProcessDefinitionBindingCandidate[];
  requiresExplicitSelection: boolean;
  createsNewDefinition: boolean;
};

export function resolveProcessRouteChangeDefinitionBinding(
  processName: unknown,
  persistedDefinitionId: unknown,
  definitions: ReadonlyArray<ProcessDefinitionBindingCandidate>,
): ProcessRouteChangeDefinitionBinding {
  const normalizedName = typeof processName === 'string'
    ? processName.trim().toLocaleLowerCase('zh-CN')
    : '';
  const persistedId = typeof persistedDefinitionId === 'string' ? persistedDefinitionId.trim() : '';
  const exactMatches = normalizedName
    ? definitions.filter(definition => definition.name.trim().toLocaleLowerCase('zh-CN') === normalizedName)
    : [];
  const persistedMatch = exactMatches.find(definition => definition.id === persistedId) || null;
  const selectedId = persistedMatch?.id || (exactMatches.length === 1 ? exactMatches[0].id : '');
  return {
    selectedId,
    exactMatches,
    requiresExplicitSelection: exactMatches.length > 1 && !selectedId,
    createsNewDefinition: exactMatches.length === 0,
  };
}

export function normalizeOptionalProcessRouteChangeNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\r\n/g, '\n');
  return normalized ? normalized.slice(0, 2_000) : null;
}

export function processRouteChangeReviewNoteError(
  _action: ProcessRouteChangeReviewAction,
  _value: unknown,
): string | null {
  return null;
}

export type ProcessRouteChangeProposalSubmitState = {
  saving: boolean;
  employeeAvailable: boolean;
  affectedQty: number;
  includesInsert: boolean;
  insertBeforeStepId: string;
  newProcessName: string;
  newStandardMillisecondsPerUnit: number | null;
  includesTime: boolean;
  timeChangesValid: boolean;
  includesMove: boolean;
  moveStepId: string;
  moveIsNoop: boolean;
};

export function canSubmitProcessRouteChangeProposal(state: ProcessRouteChangeProposalSubmitState): boolean {
  return !state.saving
    && state.employeeAvailable
    && Number.isSafeInteger(state.affectedQty)
    && state.affectedQty > 0
    && (!state.includesInsert || Boolean(
      state.insertBeforeStepId
      && state.newProcessName.trim()
      && state.newStandardMillisecondsPerUnit,
    ))
    && (!state.includesTime || state.timeChangesValid)
    && (!state.includesMove || Boolean(state.moveStepId && !state.moveIsNoop));
}

export type ProcessRouteChangeType = 'INSERT_STEP' | 'UPDATE_TIME' | 'MOVE_STEP' | 'BOTH';

export type ProcessRouteStepChangeTag = 'ADDED' | 'TIME_CHANGED' | 'ADDED_AND_TIME_CHANGED' | 'NONE';

export type ProcessRouteTimeChangeDTO = {
  stepId: string;
  processName?: string | null;
  previousStandardMillisecondsPerUnit?: number | null;
  standardMillisecondsPerUnit: number;
};

export type ProcessRouteChangePayloadDTO = {
  changeType: ProcessRouteChangeType;
  insertBeforeStepId?: string | null;
  insertAfterStepId?: string | null;
  newStepId?: string | null;
  newProcessDefinitionId?: string | null;
  newProcessName?: string | null;
  newProcessCode?: string | null;
  newStandardMillisecondsPerUnit?: number | null;
  affectedQty?: number | null;
  moveStepId?: string | null;
  moveBeforeStepId?: string | null;
  movedProcessName?: string | null;
  moveBeforeProcessName?: string | null;
  timeChanges: ProcessRouteTimeChangeDTO[];
  reason?: string | null;
};

export type ProcessRouteChangeImpactDTO = {
  downstreamReportedStepCount?: number;
  affectedCompletionCount?: number;
  affectedEmployeeCount?: number;
  affectedClaimCount?: number;
  affectedQty?: number;
  moveAffectedStepCount?: number;
  moveAffectedSequenceGroups?: number[];
  previousStandardLaborMilliseconds?: string | number | null;
  nextStandardLaborMilliseconds?: string | number | null;
  warnings?: string[];
};

export type ProcessRouteChangeDTO = {
  id: string;
  routeId: string;
  workOrderId?: string | null;
  workOrderCode?: string | null;
  title?: string | null;
  status: ProcessRouteChangeStatus;
  version: number;
  baseRouteVersion: number;
  activatedRouteVersion?: number | null;
  baseProductProfileVersion?: number | null;
  publishedProductProfileVersion?: number | null;
  payload: ProcessRouteChangePayloadDTO;
  impact?: ProcessRouteChangeImpactDTO | null;
  requesterName?: string | null;
  reviewerName?: string | null;
  reviewReason?: string | null;
  historicalLaborRecalculationPending?: boolean;
  laborCorrectionSummary?: {
    affectedCompletionCount?: number;
    affectedExecutionCount?: number;
    affectedPoolCount?: number;
    replacedActiveClaimCount?: number;
    reversalClaimCount?: number;
    affectedEmployeeCount?: number;
    affectedStepCount?: number;
  } | null;
  activationError?: string | null;
  createdAt: string;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  activatedAt?: string | null;
};

export type ProcessRouteChangeListResponse = {
  ok: boolean;
  data: ProcessRouteChangeDTO[];
  error?: string;
};

export type ProcessRouteChangeDetailResponse = {
  ok: boolean;
  data: ProcessRouteChangeDTO;
  error?: string;
};

export type ProcessRouteStepChangeNotice = {
  tag: ProcessRouteStepChangeTag;
  routeVersion: number;
  previousStandardMillisecondsPerUnit?: number | null;
  currentStandardMillisecondsPerUnit?: number | null;
  sourceChangeId?: string | null;
};

export type ActivatedProcessRouteChangeForStepNotice = {
  id: string;
  activatedRouteVersion: number | null;
  diffs: Array<{
    kind: string;
    targetStepId: string | null;
    beforeData: unknown;
  }>;
};

export type ProductTimeDeploymentForStepNotice = {
  id: string;
  status: string;
  routeVersionAfter: number | null;
  result: unknown;
  deployment: {
    id: string;
    status: string;
  };
};

export type ProcessRouteStepChangeSnapshot = {
  tag: ProcessRouteStepChangeTag;
  changeVersion: number | null;
  sourceChangeId: string | null;
  previousStandardMillisecondsPerUnit: number | null;
};

/**
 * Builds persistent per-step NEW markers from stable step data and every time
 * change that was actually applied to the current route. Changes are sorted by
 * their activated route version so a later unrelated change cannot hide an
 * older marker, while repeated time edits retain only the latest relevant diff.
 *
 * Inserted steps use WorkOrderProcessStep.changeSource as their durable source
 * of truth. This avoids loading every historical INSERT_STEP payload merely to
 * rediscover a fact already stored on the current route step.
 */
export function processRouteStepChangeSnapshots(
  steps: ReadonlyArray<{
    id: string;
    changeSource?: string | null;
    productTimeDeploymentRoute?: ProductTimeDeploymentForStepNotice | null;
  }>,
  changes: ReadonlyArray<ActivatedProcessRouteChangeForStepNotice>,
): Map<string, ProcessRouteStepChangeSnapshot> {
  const latestTimeChangeByStepId = new Map<string, {
    changeVersion: number;
    sourceChangeId: string;
    previousStandardMillisecondsPerUnit: number | null;
  }>();
  const orderedChanges = changes
    .map((change, index) => ({ change, index }))
    .filter(({ change }) => Number.isSafeInteger(change.activatedRouteVersion))
    .sort((first, second) => (
      Number(second.change.activatedRouteVersion) - Number(first.change.activatedRouteVersion)
      || first.index - second.index
    ));

  for (const { change } of orderedChanges) {
    for (const diff of change.diffs) {
      if (diff.kind !== 'UPDATE_TIME' || !diff.targetStepId || latestTimeChangeByStepId.has(diff.targetStepId)) {
        continue;
      }
      const before = record(diff.beforeData);
      const previous = Number(before.standardMillisecondsPerUnit);
      latestTimeChangeByStepId.set(diff.targetStepId, {
        changeVersion: change.activatedRouteVersion as number,
        sourceChangeId: change.id,
        previousStandardMillisecondsPerUnit: Number.isSafeInteger(previous) ? previous : null,
      });
    }
  }

  return new Map(steps.map(step => {
    const deploymentRoute = step.productTimeDeploymentRoute;
    const deploymentChanges = deploymentRoute?.status === 'SUCCEEDED'
      && deploymentRoute.deployment.status === 'ACTIVE'
      ? records(record(deploymentRoute.result).stepChanges)
          .filter(item => text(item.stepId) === step.id)
      : [];
    const deploymentInsert = deploymentChanges.find(item => text(item.kind) === 'insert') || null;
    const deploymentTime = deploymentChanges.find(item => text(item.kind) === 'update_time') || null;
    const deploymentVersion = deploymentRoute?.routeVersionAfter;
    const deploymentTimeChange = deploymentTime
      && Number.isSafeInteger(deploymentVersion)
      ? {
          changeVersion: deploymentVersion as number,
          sourceChangeId: `product-time-deployment:${deploymentRoute?.deployment.id}`,
          previousStandardMillisecondsPerUnit: number(
            deploymentTime.previousStandardMillisecondsPerUnit,
          ),
        }
      : null;
    const routeChangeTime = latestTimeChangeByStepId.get(step.id) || null;
    const timeChange = deploymentTimeChange
      && (!routeChangeTime || deploymentTimeChange.changeVersion >= routeChangeTime.changeVersion)
      ? deploymentTimeChange
      : routeChangeTime;
    const added = step.changeSource === 'NEW' || Boolean(deploymentInsert);
    const addedSourceId = deploymentInsert
      ? `product-time-deployment:${deploymentRoute?.deployment.id}`
      : null;
    return [step.id, {
      tag: added && timeChange
        ? 'ADDED_AND_TIME_CHANGED'
        : added ? 'ADDED' : timeChange ? 'TIME_CHANGED' : 'NONE',
      changeVersion: timeChange?.changeVersion ?? null,
      sourceChangeId: timeChange?.sourceChangeId ?? addedSourceId,
      previousStandardMillisecondsPerUnit: timeChange?.previousStandardMillisecondsPerUnit ?? null,
    }] as const;
  }));
}

export const processRouteChangeStatusLabels: Record<ProcessRouteChangeStatus, string> = {
  DRAFT: '草稿',
  SUBMITTED: '待工艺审核',
  APPROVED: '已通过·待启用',
  REJECTED: '已驳回',
  ACTIVATING: '启用中',
  ACTIVE: '已启用',
  FAILED: '启用失败',
};

export function processRouteChangeTypeLabel(type: ProcessRouteChangeType): string {
  if (type === 'INSERT_STEP') return '新增工序';
  if (type === 'UPDATE_TIME') return '变更工时';
  if (type === 'MOVE_STEP') return '调整工序顺序';
  return '新增工序 + 变更工时';
}

export function processRouteStepChangeLabel(notice?: ProcessRouteStepChangeNotice | null): string | null {
  if (!notice || notice.tag === 'NONE') return null;
  if (notice.tag === 'ADDED') return 'NEW · 新增工序';
  if (notice.tag === 'TIME_CHANGED') return 'NEW · 工时已变更';
  return 'NEW · 新工序/工时';
}

export function secondsFromMilliseconds(value?: number | null): string {
  if (!value || value <= 0) return '0';
  const seconds = value / 1000;
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}

export function millisecondsFromSeconds(value: unknown): number | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const milliseconds = Math.round(seconds * 1000);
  return Number.isSafeInteger(milliseconds) && milliseconds > 0 ? milliseconds : null;
}

export function processRouteChangeIdempotencyKey(prefix: string): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function text(value: unknown): string | null {
  const result = typeof value === 'string' ? value.trim() : '';
  return result || null;
}

function number(value: unknown): number | null {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function integer(value: unknown, fallback = 0): number {
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : fallback;
}

function dateText(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

function changeStatus(value: unknown): ProcessRouteChangeStatus {
  return ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ACTIVATING', 'ACTIVE', 'FAILED'].includes(String(value))
    ? value as ProcessRouteChangeStatus
    : 'DRAFT';
}

function summary(value: unknown): ProcessRouteChangeDTO['laborCorrectionSummary'] {
  const source = record(value);
  if (!Object.keys(source).length) return null;
  return {
    affectedCompletionCount: integer(source.affectedCompletionCount),
    affectedExecutionCount: integer(source.affectedExecutionCount),
    affectedPoolCount: integer(source.affectedPoolCount),
    replacedActiveClaimCount: integer(source.replacedActiveClaimCount),
    reversalClaimCount: integer(source.reversalClaimCount),
    affectedEmployeeCount: integer(source.affectedEmployeeCount),
    affectedStepCount: integer(source.affectedStepCount),
  };
}

/**
 * Keeps the browser contract stable while the service returns persistence-shaped
 * route-change records. It deliberately derives display fields from immutable
 * diffs instead of trusting a second, editable payload copy.
 */
export function processRouteChangeDTO(value: unknown): ProcessRouteChangeDTO {
  const source = record(value);
  const existingPayload = record(source.payload);
  const diffs = records(source.diffs);
  const insert = diffs.find(diff => diff.kind === 'INSERT_STEP') || {};
  const insertAfter = record(insert.afterData);
  const timeDiffs = diffs.filter(diff => diff.kind === 'UPDATE_TIME');
  const move = diffs.find(diff => diff.kind === 'MOVE_STEP') || {};
  const moveAfter = record(move.afterData);
  const hasInsert = Boolean(Object.keys(insert).length)
    || existingPayload.changeType === 'INSERT_STEP'
    || existingPayload.changeType === 'BOTH';
  const hasTime = timeDiffs.length > 0
    || existingPayload.changeType === 'UPDATE_TIME'
    || existingPayload.changeType === 'BOTH';
  const hasMove = Boolean(Object.keys(move).length)
    || existingPayload.changeType === 'MOVE_STEP';
  const changeType: ProcessRouteChangeType = hasMove
    ? 'MOVE_STEP'
    : hasInsert && hasTime
    ? 'BOTH'
    : hasTime ? 'UPDATE_TIME' : 'INSERT_STEP';
  const timeChanges = timeDiffs.length
    ? timeDiffs.map(diff => {
        const before = record(diff.beforeData);
        const after = record(diff.afterData);
        return {
          stepId: text(diff.targetStepId) || '',
          processName: text(after.processName) || text(before.processName),
          previousStandardMillisecondsPerUnit: number(before.standardMillisecondsPerUnit),
          standardMillisecondsPerUnit: integer(after.standardMillisecondsPerUnit),
        };
      })
    : records(existingPayload.timeChanges).map(item => ({
        stepId: text(item.stepId) || '',
        processName: text(item.processName),
        previousStandardMillisecondsPerUnit: number(item.previousStandardMillisecondsPerUnit),
        standardMillisecondsPerUnit: integer(item.standardMillisecondsPerUnit),
      }));
  const impactSource = record(source.impactSnapshot || source.impact);
  const routeSnapshot = record(source.routeSnapshot);
  const snapshotSteps = records(routeSnapshot.steps);
  const movedSnapshot = snapshotSteps.find(step => text(step.id) === text(move.targetStepId));
  const moveBeforeSnapshot = snapshotSteps.find(step => text(step.id) === (text(moveAfter.beforeStepId) || text(existingPayload.moveBeforeStepId)));
  const request = record(source.changeRequest);
  const workOrder = record(source.workOrder);
  const createdBy = record(source.createdBy);
  const reviewedBy = record(source.reviewedBy);
  const affectedCompletionCount = integer(impactSource.affectedCompletionCount);
  const recalculationPending = source.historicalLaborRecalculationPending === true;
  const warnings = Array.isArray(impactSource.warnings)
    ? impactSource.warnings.map(item => typeof item === 'string' ? item.trim() : text(record(item).message)).filter((item): item is string => Boolean(item))
    : [];
  if (affectedCompletionCount > 0) warnings.push(`有 ${affectedCompletionCount} 笔历史报工需要按新工时追溯重算。`);
  if (recalculationPending) warnings.push('路线已启用，但历史工时与达成率仍在等待重算，暂不能视为最终结果。');

  const payload: ProcessRouteChangePayloadDTO = {
    changeType,
    insertBeforeStepId: text(insertAfter.insertBeforeStepId)
      || text(insert.targetStepId)
      || text(existingPayload.insertBeforeStepId),
    insertAfterStepId: text(existingPayload.insertAfterStepId),
    newStepId: text(existingPayload.newStepId),
    newProcessDefinitionId: text(insert.processDefinitionId)
      || text(insertAfter.processDefinitionId)
      || text(existingPayload.newProcessDefinitionId),
    newProcessName: text(insertAfter.processName) || text(existingPayload.newProcessName),
    newProcessCode: text(insertAfter.processCode) || text(existingPayload.newProcessCode),
    newStandardMillisecondsPerUnit: number(insertAfter.standardMillisecondsPerUnit)
      ?? number(existingPayload.newStandardMillisecondsPerUnit),
    affectedQty: number(insertAfter.requiredQty)
      ?? number(existingPayload.affectedQty)
      ?? number(impactSource.affectedQty),
    moveStepId: text(move.targetStepId) || text(existingPayload.moveStepId),
    moveBeforeStepId: text(moveAfter.beforeStepId) || text(existingPayload.moveBeforeStepId),
    movedProcessName: text(record(move.beforeData).processName) || text(movedSnapshot?.processName) || text(existingPayload.movedProcessName),
    moveBeforeProcessName: text(moveAfter.beforeProcessName) || text(moveBeforeSnapshot?.processName) || text(existingPayload.moveBeforeProcessName),
    timeChanges,
    reason: text(request.reason) || text(existingPayload.reason),
  };

  return {
    id: text(source.id) || '',
    routeId: text(source.routeId) || '',
    workOrderId: text(source.workOrderId),
    workOrderCode: text(workOrder.code) || text(source.workOrderCode),
    title: text(request.title) || text(source.title),
    status: changeStatus(source.status),
    version: integer(source.version),
    baseRouteVersion: integer(source.baseRouteVersion),
    activatedRouteVersion: number(source.activatedRouteVersion),
    baseProductProfileVersion: number(source.baseProductProfileVersion),
    publishedProductProfileVersion: number(source.publishedProductProfileVersion),
    payload,
    impact: {
      downstreamReportedStepCount: integer(impactSource.downstreamReportedStepCount),
      affectedCompletionCount,
      affectedEmployeeCount: integer(impactSource.affectedEmployeeCount),
      affectedClaimCount: integer(impactSource.affectedClaimCount),
      affectedQty: integer(impactSource.affectedQty || payload.affectedQty),
      moveAffectedStepCount: integer(impactSource.moveAffectedStepCount),
      moveAffectedSequenceGroups: Array.isArray(impactSource.moveAffectedSequenceGroups)
        ? impactSource.moveAffectedSequenceGroups.map(item => integer(item)).filter(item => item > 0)
        : [],
      previousStandardLaborMilliseconds: number(impactSource.previousStandardLaborMilliseconds),
      nextStandardLaborMilliseconds: number(impactSource.nextStandardLaborMilliseconds),
      warnings: [...new Set(warnings)],
    },
    requesterName: text(createdBy.displayName) || text(createdBy.username) || text(source.requesterName),
    reviewerName: text(reviewedBy.displayName) || text(reviewedBy.username) || text(source.reviewerName),
    reviewReason: text(source.reviewNote) || text(source.reviewReason),
    historicalLaborRecalculationPending: recalculationPending,
    laborCorrectionSummary: summary(source.laborCorrectionSummary),
    activationError: text(source.activationError),
    createdAt: dateText(source.createdAt) || new Date(0).toISOString(),
    submittedAt: dateText(source.submittedAt),
    reviewedAt: dateText(source.reviewedAt),
    activatedAt: dateText(source.activatedAt),
  };
}

export function processRouteChangeDTOs(value: unknown): ProcessRouteChangeDTO[] {
  return Array.isArray(value) ? value.map(processRouteChangeDTO) : [];
}
