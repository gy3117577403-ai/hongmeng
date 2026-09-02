import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type {
  SampleDataKindDTO,
  SampleDataStatusDTO,
  SamplePhotoCategoryDTO,
  SamplePackageDecisionDTO,
  SamplePublishModeDTO,
  SampleReviewStatusDTO,
  SampleSubmissionStatusDTO,
  SampleTaskDTO,
  SampleTaskStatusDTO,
} from '@/types';

export const SAMPLE_DATA_KINDS: readonly SampleDataKindDTO[] = [
  'PROCESS_TIME',
  'STRIPPING',
  'MATERIAL',
  'NOTICE',
  'CUSTOM',
] as const;

export const SAMPLE_DRAFT_SECTION_KINDS = ['PROCESS_TIME', 'STRIPPING'] as const;
export type SampleDraftSectionKind = (typeof SAMPLE_DRAFT_SECTION_KINDS)[number];

export const SAMPLE_PHOTO_CATEGORIES: readonly SamplePhotoCategoryDTO[] = [
  'UNCLASSIFIED',
  'PROCESS_TIME',
  'STRIPPING',
  'MATERIAL',
  'NOTICE',
  'SEMI_FINISHED',
  'PROCESS',
  'MEASUREMENT',
  'FINISHED',
  'DETAIL',
  'EXCEPTION',
] as const;

export const SAMPLE_PUBLISH_MODES: readonly SamplePublishModeDTO[] = [
  'APPEND',
  'REPLACE_MATCHING',
  'RECORD_ONLY',
] as const;

export const SAMPLE_TASK_STATUSES: readonly SampleTaskStatusDTO[] = [
  'PLANNED',
  'IN_PROGRESS',
  'SUBMITTED',
  'COMPLETED',
  'CANCELLED',
] as const;

export const sampleTaskInclude = {
  drawingLibraryItem: {
    select: {
      id: true,
      customerName: true,
      productName: true,
      specification: true,
      libraryKey: true,
    },
  },
  assignees: {
    include: {
      employee: {
        select: {
          id: true,
          employeeNo: true,
          name: true,
          team: true,
          position: true,
          isActive: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  entries: {
    where: { deletedAt: null },
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
  photos: {
    where: { deletedAt: null },
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
  draftSections: {
    orderBy: { kind: 'asc' as const },
  },
  activeSubmission: {
    select: {
      id: true,
      revision: true,
      status: true,
      submittedByName: true,
      submittedAt: true,
      withdrawnByName: true,
      withdrawnAt: true,
      withdrawalReason: true,
      decision: true,
      decisionComment: true,
      decidedByName: true,
      decidedAt: true,
    },
  },
  acceptedSubmission: {
    select: {
      id: true,
      revision: true,
      status: true,
      submittedByName: true,
      submittedAt: true,
      withdrawnByName: true,
      withdrawnAt: true,
      withdrawalReason: true,
      decision: true,
      decisionComment: true,
      decidedByName: true,
      decidedAt: true,
    },
  },
} satisfies Prisma.SampleTaskInclude;

export type SampleTaskRecord = Prisma.SampleTaskGetPayload<{ include: typeof sampleTaskInclude }>;

export type SampleActor = {
  id: string;
  name: string;
};

export function sampleActor(user: { id: string; displayName?: string | null; username?: string | null }): SampleActor {
  return {
    id: user.id,
    name: cleanSampleText(user.displayName, 80) || cleanSampleText(user.username, 80) || '当前用户',
  };
}
export function cleanSampleText(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

export function cleanSampleColor(value: unknown): string | null {
  const text = cleanSampleText(value, 20);
  return text && /^#[0-9a-f]{6}$/i.test(text) ? text.toUpperCase() : null;
}

export function parseOptionalSampleDate(value: unknown): Date | null {
  const text = cleanSampleText(value, 20);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('INVALID_SAMPLE_DATE');
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw new Error('INVALID_SAMPLE_DATE');
  return date;
}

export function parseOptionalNonNegativeInteger(value: unknown, max = 1_000_000): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > max) throw new Error('INVALID_SAMPLE_NUMBER');
  return number;
}

export function sampleTaskCode(now = new Date()): string {
  const date = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  return `YP-${date}-${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

export function sampleQrCode(): string {
  return randomBytes(18).toString('base64url');
}

export function isSampleDataKind(value: unknown): value is SampleDataKindDTO {
  return typeof value === 'string' && SAMPLE_DATA_KINDS.includes(value as SampleDataKindDTO);
}

export function isSampleDraftSectionKind(value: unknown): value is SampleDraftSectionKind {
  return typeof value === 'string' && SAMPLE_DRAFT_SECTION_KINDS.includes(value as SampleDraftSectionKind);
}

export function isSamplePhotoCategory(value: unknown): value is SamplePhotoCategoryDTO {
  return typeof value === 'string' && SAMPLE_PHOTO_CATEGORIES.includes(value as SamplePhotoCategoryDTO);
}

export function isSamplePublishMode(value: unknown): value is SamplePublishModeDTO {
  return typeof value === 'string' && SAMPLE_PUBLISH_MODES.includes(value as SamplePublishModeDTO);
}

export function isSampleTaskStatus(value: unknown): value is SampleTaskStatusDTO {
  return typeof value === 'string' && SAMPLE_TASK_STATUSES.includes(value as SampleTaskStatusDTO);
}

export function sanitizeSamplePayload(value: unknown): Prisma.InputJsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const text = JSON.stringify(value);
  if (text.length > 40_000) throw new Error('SAMPLE_PAYLOAD_TOO_LARGE');
  return JSON.parse(text) as Prisma.InputJsonObject;
}

function draftRowId(value: unknown): string {
  const rowId = cleanSampleText(value, 80);
  if (!rowId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(rowId)) throw new Error('INVALID_SAMPLE_DRAFT_ROW');
  return rowId;
}

function draftPosition(value: unknown): number {
  const position = Number(value);
  if (!Number.isInteger(position) || position < 0 || position > 10_000) throw new Error('INVALID_SAMPLE_DRAFT_ROW');
  return position;
}

function optionalMeasuredMilliseconds(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const milliseconds = Number(value);
  if (!Number.isInteger(milliseconds) || milliseconds <= 0 || milliseconds > 604_800_000) {
    throw new Error('INVALID_SAMPLE_PROCESS_TIME');
  }
  return milliseconds;
}

function optionalDecimalText(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const text = typeof value === 'number' ? String(value) : cleanSampleText(value, 30);
  if (!text || !/^\d{1,6}(?:\.\d{1,3})?$/.test(text) || Number(text) > 100_000) {
    throw new Error('INVALID_SAMPLE_STRIPPING_VALUE');
  }
  return String(Number(text));
}

function sectionRows(value: unknown): unknown[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_SAMPLE_DRAFT_SECTION');
  const rows = (value as Record<string, unknown>).rows;
  if (!Array.isArray(rows)) throw new Error('INVALID_SAMPLE_DRAFT_SECTION');
  if (rows.length > 50) throw new Error('SAMPLE_DRAFT_ROW_LIMIT');
  return rows;
}

export function sanitizeSampleDraftSection(
  kind: SampleDraftSectionKind,
  value: unknown,
): Prisma.InputJsonObject {
  const rows = sectionRows(value);
  const seen = new Set<string>();
  if (kind === 'PROCESS_TIME') {
    return {
      rows: rows.map(raw => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('INVALID_SAMPLE_DRAFT_ROW');
        const row = raw as Record<string, unknown>;
        const rowId = draftRowId(row.rowId);
        if (seen.has(rowId)) throw new Error('DUPLICATE_SAMPLE_DRAFT_ROW');
        seen.add(rowId);
        const processDefinitionId = cleanSampleText(row.processDefinitionId, 80);
        const processName = cleanSampleText(row.processName, 120) || '';
        const processOrigin = row.processOrigin === 'MASTER' ? 'MASTER' : row.processOrigin === 'PROPOSED' ? 'PROPOSED' : null;
        const measuredMilliseconds = optionalMeasuredMilliseconds(row.measuredMilliseconds);
        const hasData = Boolean(processDefinitionId || processName || measuredMilliseconds !== null);
        const normalizedOrigin = processOrigin || (processDefinitionId ? 'MASTER' : 'PROPOSED');
        const stageGroup = row.stageGroup === 'backend' || row.stageGroup === 'finish' ? row.stageGroup : 'frontend';
        if (hasData && normalizedOrigin === 'MASTER' && !processDefinitionId) throw new Error('INVALID_SAMPLE_PROCESS_REFERENCE');
        if (normalizedOrigin === 'PROPOSED' && processDefinitionId) throw new Error('INVALID_SAMPLE_PROCESS_REFERENCE');
        return {
          rowId,
          position: draftPosition(row.position),
          processDefinitionId,
          processName,
          processOrigin: normalizedOrigin,
          stageGroup,
          measuredMilliseconds,
        };
      }),
    };
  }
  return {
    rows: rows.map(raw => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('INVALID_SAMPLE_DRAFT_ROW');
      const row = raw as Record<string, unknown>;
      const rowId = draftRowId(row.rowId);
      if (seen.has(rowId)) throw new Error('DUPLICATE_SAMPLE_DRAFT_ROW');
      seen.add(rowId);
      return {
        rowId,
        position: draftPosition(row.position),
        model: cleanSampleText(row.model, 160) || '',
        outerPeelMm: optionalDecimalText(row.outerPeelMm),
        innerPeelMm: optionalDecimalText(row.innerPeelMm),
        insertionLengthMm: optionalDecimalText(row.insertionLengthMm),
      };
    }),
  };
}

export function sanitizeSampleDraftUiState(value: unknown): Prisma.InputJsonObject {
  if (value === null || value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_SAMPLE_DRAFT_UI_STATE');
  const text = JSON.stringify(value);
  if (text.length > 10_000) throw new Error('SAMPLE_DRAFT_UI_STATE_TOO_LARGE');
  return JSON.parse(text) as Prisma.InputJsonObject;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

export function sampleRequestHash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function sampleDraftSectionHasData(value: Prisma.JsonValue | Prisma.InputJsonValue): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const rows = (value as Record<string, unknown>).rows;
  if (!Array.isArray(rows)) return false;
  return rows.some(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const row = raw as Record<string, unknown>;
    return Object.entries(row).some(([key, item]) => !['rowId', 'position', 'processOrigin'].includes(key) && item !== null && item !== '');
  });
}

export function sampleDraftSectionHasUnsubmittedChange(section: {
  payload: Prisma.JsonValue | Prisma.InputJsonValue;
  revision: number;
  lastSubmittedRevision: number;
}): boolean {
  return section.revision > section.lastSubmittedRevision
    && (section.lastSubmittedRevision > 0 || sampleDraftSectionHasData(section.payload));
}

export function serializeSampleDraftSection(section: {
  id: string;
  taskId: string;
  kind: string;
  schemaVersion: number;
  revision: number;
  lastSubmittedRevision: number;
  payload: Prisma.JsonValue;
  uiState: Prisma.JsonValue | null;
  updatedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: section.id,
    taskId: section.taskId,
    kind: section.kind as SampleDraftSectionKind,
    schemaVersion: section.schemaVersion,
    revision: section.revision,
    lastSubmittedRevision: section.lastSubmittedRevision,
    payload: jsonRecord(section.payload),
    uiState: section.uiState ? jsonRecord(section.uiState) : {},
    updatedBy: section.updatedByName,
    createdAt: section.createdAt.toISOString(),
    updatedAt: section.updatedAt.toISOString(),
  };
}

export function serializeSampleSubmission(submission: {
  id: string;
  taskId: string;
  revision: number;
  status: string;
  submittedByName: string | null;
  submittedAt: Date;
  withdrawnByName: string | null;
  withdrawnAt: Date | null;
  withdrawalReason: string | null;
  decision: string | null;
  decisionComment: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
}) {
  return {
    id: submission.id,
    taskId: submission.taskId,
    revision: submission.revision,
    status: submission.status as SampleSubmissionStatusDTO,
    submittedBy: submission.submittedByName,
    submittedAt: submission.submittedAt.toISOString(),
    withdrawnBy: submission.withdrawnByName,
    withdrawnAt: submission.withdrawnAt?.toISOString() || null,
    withdrawalReason: submission.withdrawalReason,
    decision: submission.decision as SamplePackageDecisionDTO | null,
    decisionComment: submission.decisionComment,
    decidedBy: submission.decidedByName,
    decidedAt: submission.decidedAt?.toISOString() || null,
  };
}

function jsonRecord(value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

type ReviewStateInput = {
  reviewStatus: string;
  publishedEntityType?: string | null;
};

export function deriveSampleDataStatus(
  entries: readonly ReviewStateInput[],
  photos: readonly ReviewStateInput[],
): SampleDataStatusDTO {
  const records = [...entries, ...photos];
  if (!records.length) return 'NO_DATA';
  if (records.some(item => item.reviewStatus === 'CHANGES_REQUESTED')) return 'NEEDS_CHANGES';
  if (records.some(item => item.reviewStatus === 'PENDING')) return 'PENDING_REVIEW';
  if (records.some(item => item.reviewStatus === 'DRAFT')) return 'COLLECTING';
  const published = records.filter(item => item.reviewStatus === 'PUBLISHED').length;
  const approvedDrafts = records.filter(item => item.reviewStatus === 'APPROVED' && item.publishedEntityType).length;
  if (published > 0 && approvedDrafts > 0) return 'PARTIALLY_PUBLISHED';
  return 'PROCESSED';
}

export async function refreshSampleTaskDataStatus(
  tx: Prisma.TransactionClient,
  taskId: string,
): Promise<SampleDataStatusDTO> {
  const [entries, photos, draftSections] = await Promise.all([
    tx.sampleDataEntry.findMany({
      where: { taskId, deletedAt: null },
      select: { reviewStatus: true, publishedEntityType: true },
    }),
    tx.samplePhoto.findMany({
      where: { taskId, deletedAt: null },
      select: { reviewStatus: true },
    }),
    tx.sampleDraftSection.findMany({ where: { taskId }, select: { payload: true, revision: true, lastSubmittedRevision: true } }),
  ]);
  let dataStatus = deriveSampleDataStatus(entries, photos);
  const hasUnsavedSectionData = draftSections.some(sampleDraftSectionHasUnsubmittedChange);
  if (!['PENDING_REVIEW', 'NEEDS_CHANGES'].includes(dataStatus) && hasUnsavedSectionData) dataStatus = 'COLLECTING';
  await tx.sampleTask.update({ where: { id: taskId }, data: { dataStatus } });
  return dataStatus;
}

export function sampleTaskStatusAfterCapture(status: string): SampleTaskStatusDTO {
  if (status === 'SUBMITTED' || status === 'COMPLETED' || status === 'CANCELLED') return status as SampleTaskStatusDTO;
  return 'IN_PROGRESS';
}

export function serializeSampleTask(task: SampleTaskRecord): SampleTaskDTO {
  let dataStatus = deriveSampleDataStatus(task.entries, task.photos);
  const hasUnsavedSectionData = task.draftSections.some(sampleDraftSectionHasUnsubmittedChange);
  if (!['PENDING_REVIEW', 'NEEDS_CHANGES'].includes(dataStatus) && hasUnsavedSectionData) dataStatus = 'COLLECTING';
  const activeRecords = [...task.entries, ...task.photos];
  return {
    id: task.id,
    code: task.code,
    qrCode: task.qrCode,
    captureUrl: `/sample-capture/${encodeURIComponent(task.qrCode)}`,
    drawingLibraryItemId: task.drawingLibraryItemId,
    sourceOrderNo: task.sourceOrderNo,
    customerName: task.customerNameSnapshot,
    productName: task.productNameSnapshot,
    specification: task.specificationSnapshot,
    customerLevelCode: task.customerLevelCode,
    customerLevelLabel: task.customerLevelLabel,
    customerLevelColor: task.customerLevelColor,
    sampleQuantity: task.sampleQuantity,
    dueDate: task.dueDate?.toISOString().slice(0, 10) || null,
    priority: task.priority,
    status: task.status as SampleTaskStatusDTO,
    dataStatus,
    planRemark: task.planRemark,
    version: task.version,
    submissionRevision: task.submissionRevision,
    activeSubmissionId: task.activeSubmissionId,
    acceptedSubmissionId: task.acceptedSubmissionId,
    lastEditedKind: task.lastEditedKind as SampleDraftSectionKind | null,
    lastEditedRowId: task.lastEditedRowId,
    activeSubmission: task.activeSubmission ? serializeSampleSubmission({ ...task.activeSubmission, taskId: task.id }) : null,
    acceptedSubmission: task.acceptedSubmission ? serializeSampleSubmission({ ...task.acceptedSubmission, taskId: task.id }) : null,
    startedAt: task.startedAt?.toISOString() || null,
    submittedAt: task.submittedAt?.toISOString() || null,
    completedAt: task.completedAt?.toISOString() || null,
    cancelledAt: task.cancelledAt?.toISOString() || null,
    archivedAt: task.archivedAt?.toISOString() || null,
    archivedBy: task.archivedByName,
    archiveReason: task.archiveReason,
    createdBy: task.createdByName,
    updatedBy: task.updatedByName,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    assignees: task.assignees.map(assignment => ({
      id: assignment.id,
      employeeId: assignment.employeeId,
      employeeNo: assignment.employee.employeeNo,
      name: assignment.employee.name,
      team: assignment.employee.team,
      position: assignment.employee.position,
    })),
    sections: task.draftSections.map(serializeSampleDraftSection),
    entries: task.entries.map(entry => ({
      id: entry.id,
      taskId: entry.taskId,
      kind: entry.kind as SampleDataKindDTO,
      label: entry.label,
      payload: jsonRecord(entry.payload),
      clientMutationId: entry.clientMutationId,
      submissionRevision: entry.submissionRevision,
      reviewStatus: entry.reviewStatus as SampleReviewStatusDTO,
      publishMode: entry.publishMode as SamplePublishModeDTO | null,
      reviewComment: entry.reviewComment,
      createdBy: entry.createdByName,
      updatedBy: entry.updatedByName,
      reviewedBy: entry.reviewedByName,
      reviewedAt: entry.reviewedAt?.toISOString() || null,
      publishedBy: entry.publishedByName,
      publishedAt: entry.publishedAt?.toISOString() || null,
      publishedEntityType: entry.publishedEntityType,
      publishedEntityId: entry.publishedEntityId,
      version: entry.version,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    })),
    photos: task.photos.map(photo => ({
      id: photo.id,
      taskId: photo.taskId,
      linkedEntryId: photo.linkedEntryId,
      clientMutationId: photo.clientMutationId,
      category: photo.category as SamplePhotoCategoryDTO,
      caption: photo.caption,
      originalName: photo.originalName,
      mimeType: photo.mimeType,
      size: photo.size,
      captureSource: photo.captureSource,
      sourceOriginalName: photo.sourceOriginalName,
      sortOrder: photo.sortOrder,
      submissionRevision: photo.submissionRevision,
      reviewStatus: photo.reviewStatus as SampleReviewStatusDTO,
      reviewComment: photo.reviewComment,
      uploadedBy: photo.uploadedByName,
      reviewedBy: photo.reviewedByName,
      reviewedAt: photo.reviewedAt?.toISOString() || null,
      publishedBy: photo.publishedByName,
      publishedAt: photo.publishedAt?.toISOString() || null,
      publishedFileId: photo.publishedFileId,
      version: photo.version,
      createdAt: photo.createdAt.toISOString(),
      updatedAt: photo.updatedAt.toISOString(),
      contentUrl: `/api/sample-photos/${photo.id}/content`,
    })),
    counts: {
      data: task.entries.length,
      photos: task.photos.length,
      pendingItems: activeRecords.filter(item => item.reviewStatus === 'PENDING').length,
      pendingReview: task.activeSubmission?.status === 'PENDING' ? 1 : 0,
      changesRequested: activeRecords.filter(item => item.reviewStatus === 'CHANGES_REQUESTED').length,
      published: activeRecords.filter(item => item.reviewStatus === 'PUBLISHED').length,
    },
  };
}
