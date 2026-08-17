import { randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type {
  SampleDataKindDTO,
  SampleDataStatusDTO,
  SamplePhotoCategoryDTO,
  SamplePublishModeDTO,
  SampleReviewStatusDTO,
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

export const SAMPLE_PHOTO_CATEGORIES: readonly SamplePhotoCategoryDTO[] = [
  'UNCLASSIFIED',
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
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
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
  const [entries, photos] = await Promise.all([
    tx.sampleDataEntry.findMany({
      where: { taskId, deletedAt: null },
      select: { reviewStatus: true, publishedEntityType: true },
    }),
    tx.samplePhoto.findMany({
      where: { taskId, deletedAt: null },
      select: { reviewStatus: true },
    }),
  ]);
  const dataStatus = deriveSampleDataStatus(entries, photos);
  await tx.sampleTask.update({ where: { id: taskId }, data: { dataStatus } });
  return dataStatus;
}

export function sampleTaskStatusAfterCapture(status: string): SampleTaskStatusDTO {
  if (status === 'COMPLETED' || status === 'CANCELLED') return status as SampleTaskStatusDTO;
  return 'IN_PROGRESS';
}

export function serializeSampleTask(task: SampleTaskRecord): SampleTaskDTO {
  const dataStatus = deriveSampleDataStatus(task.entries, task.photos);
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
    startedAt: task.startedAt?.toISOString() || null,
    submittedAt: task.submittedAt?.toISOString() || null,
    completedAt: task.completedAt?.toISOString() || null,
    cancelledAt: task.cancelledAt?.toISOString() || null,
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
    entries: task.entries.map(entry => ({
      id: entry.id,
      taskId: entry.taskId,
      kind: entry.kind as SampleDataKindDTO,
      label: entry.label,
      payload: jsonRecord(entry.payload),
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
      category: photo.category as SamplePhotoCategoryDTO,
      caption: photo.caption,
      originalName: photo.originalName,
      mimeType: photo.mimeType,
      size: photo.size,
      captureSource: photo.captureSource,
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
      pendingReview: activeRecords.filter(item => item.reviewStatus === 'PENDING').length,
      changesRequested: activeRecords.filter(item => item.reviewStatus === 'CHANGES_REQUESTED').length,
      published: activeRecords.filter(item => item.reviewStatus === 'PUBLISHED').length,
    },
  };
}
