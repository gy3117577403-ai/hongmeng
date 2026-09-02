import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { ForbiddenError, forbidden, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { hasCapability } from '@/lib/department-access';
import { prisma } from '@/lib/prisma';
import {
  ProcessDefinitionResolutionError,
  resolveOrCreateProcessDefinition,
} from '@/lib/process-definition-resolver';
import {
  cleanSampleText,
  isSamplePhotoCategory,
  sampleActor,
  sampleRequestHash,
  sampleTaskInclude,
  serializeSampleTask,
} from '@/lib/sample-team';
import {
  finalizeSamplePhotoPublication,
  publishSampleEntry,
  publishSamplePhoto,
  SamplePublishError,
} from '@/lib/sample-team-publish';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PackageDecision = 'CONFIRM' | 'EDIT' | 'REJECT';
type JsonRecord = Record<string, unknown>;
type ReviewIssue = {
  itemType: 'entry' | 'photo' | 'submission';
  itemId: string;
  title: string;
  message: string;
};

class SamplePackageReviewError extends Error {
  constructor(
    message: string,
    public code: string,
    public status = 409,
    public issues: ReviewIssue[] = [],
  ) {
    super(message);
  }
}

function packageDecision(value: unknown): PackageDecision | null {
  return value === 'CONFIRM' || value === 'EDIT' || value === 'REJECT' ? value : null;
}

function jsonRecord(value: Prisma.JsonValue | unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function own(value: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function finiteNumber(value: unknown, min: number, max: number, integer = false): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    throw new SamplePackageReviewError('编辑内容中有无效数字，请修正后保存', 'SAMPLE_REVIEW_EDIT_INVALID', 400);
  }
  return parsed;
}

const ENTRY_TEXT_FIELDS: Record<string, readonly string[]> = {
  PROCESS_TIME: ['unitLabel', 'remark'],
  STRIPPING: ['model', 'outerPeelMm', 'innerPeelMm', 'insertionLengthMm', 'positionLabel', 'remark'],
  MATERIAL: ['name', 'specification', 'length', 'quantity', 'unit', 'tolerance', 'position', 'remark'],
  NOTICE: ['category', 'severity', 'content', 'processName', 'remark'],
  CUSTOM: ['value', 'unit', 'remark'],
};

async function sanitizeEntryEdit(
  tx: Prisma.TransactionClient,
  kind: string,
  currentValue: Prisma.JsonValue,
  patchValue: unknown,
): Promise<Prisma.InputJsonObject> {
  const current = jsonRecord(currentValue);
  const patch = jsonRecord(patchValue);
  const next: JsonRecord = { ...current };
  for (const key of ENTRY_TEXT_FIELDS[kind] || []) {
    if (!own(patch, key)) continue;
    next[key] = cleanSampleText(patch[key], key === 'content' || key === 'remark' ? 1000 : 180);
  }

  if (kind === 'PROCESS_TIME') {
    const candidateName = own(patch, 'processName')
      ? cleanSampleText(patch.processName, 60)
      : cleanSampleText(current.processName, 60);
    const candidateStageGroup = patch.stageGroup === 'backend' || patch.stageGroup === 'finish'
      ? patch.stageGroup
      : current.stageGroup === 'backend' || current.stageGroup === 'finish'
        ? current.stageGroup
        : 'frontend';
    if (own(patch, 'processDefinitionId')) {
      const processDefinitionId = cleanSampleText(patch.processDefinitionId, 80);
      if (!processDefinitionId) {
        next.processDefinitionId = null;
        next.processName = candidateName;
        next.stageGroup = candidateStageGroup;
        next.processOrigin = 'PROPOSED';
        next.mappedByReview = false;
      } else {
        const definition = await tx.processDefinition.findFirst({
          where: { id: processDefinitionId, isActive: true },
          select: { id: true, name: true, stageGroup: true },
        });
        if (!definition) {
          throw new SamplePackageReviewError('选择的正式工序已停用或不存在', 'SAMPLE_PROCESS_NOT_FOUND', 409);
        }
        const previousName = cleanSampleText(current.processName, 120);
        next.processDefinitionId = definition.id;
        next.processName = definition.name;
        next.stageGroup = definition.stageGroup;
        next.processOrigin = 'MASTER';
        next.mappedFromProcessName = previousName;
        next.mappedByReview = true;
      }
    } else if (!cleanSampleText(current.processDefinitionId, 80) && own(patch, 'processName')) {
      next.processName = candidateName;
      next.stageGroup = candidateStageGroup;
      next.processOrigin = 'PROPOSED';
      next.mappedByReview = false;
    }
    if (own(patch, 'recommendedSeconds')) {
      const seconds = finiteNumber(patch.recommendedSeconds, 0.001, 604_800);
      next.recommendedSeconds = seconds;
      next.measuredMilliseconds = seconds === null ? null : Math.max(1, Math.round(seconds * 1000));
    }
    if (own(patch, 'setupSeconds')) next.setupSeconds = finiteNumber(patch.setupSeconds, 0, 604_800);
    if (own(patch, 'occurrences')) next.occurrences = finiteNumber(patch.occurrences, 1, 1000, true) ?? 1;
    if (own(patch, 'timeBasis')) next.timeBasis = patch.timeBasis === 'per_batch' ? 'per_batch' : 'per_unit';
  }

  return JSON.parse(JSON.stringify(next)) as Prisma.InputJsonObject;
}

function hasMeaningfulBusinessValue(kind: string, label: string | null, payloadValue: Prisma.JsonValue): boolean {
  if (kind === 'PROCESS_TIME') return true;
  if (kind !== 'STRIPPING' && label) return true;
  const payload = jsonRecord(payloadValue);
  const keys = ENTRY_TEXT_FIELDS[kind] || [];
  return keys.some(key => {
    const value = payload[key];
    if (typeof value === 'string') return value.trim().length > 0;
    return typeof value === 'number' && Number.isFinite(value);
  });
}

function processSeconds(payloadValue: Prisma.JsonValue): number | null {
  const payload = jsonRecord(payloadValue);
  const recommended = Number(payload.recommendedSeconds);
  if (Number.isFinite(recommended) && recommended > 0) return recommended;
  if (!Array.isArray(payload.measurements)) return null;
  const measurements = payload.measurements
    .map(item => Number(jsonRecord(item).value ?? item))
    .filter(value => Number.isFinite(value) && value > 0);
  if (!measurements.length) return null;
  return measurements.reduce((sum, value) => sum + value, 0) / measurements.length;
}

function photoCategoryCode(category: string): string {
  if (category === 'FINISHED') return 'product';
  if (category === 'MEASUREMENT') return 'sample_measurement';
  if (category === 'PROCESS_TIME') return 'sample_process_time';
  if (category === 'STRIPPING') return 'sample_parameters';
  if (category === 'MATERIAL') return 'material';
  if (category === 'NOTICE') return 'notice';
  if (category === 'SEMI_FINISHED') return 'sample_semi_finished';
  if (category === 'EXCEPTION') return 'sample_exception';
  return 'sample_process';
}

function reviewedSnapshot(
  task: { id: string; code: string; submissionRevision: number; customerNameSnapshot: string; productNameSnapshot: string | null; specificationSnapshot: string },
  entries: Array<{ id: string; kind: string; label: string | null; payload: Prisma.JsonValue; version: number; reviewStatus: string }>,
  photos: Array<{ id: string; category: string; caption: string | null; originalName: string; mimeType: string; size: number; sha256: string; version: number; reviewStatus: string }>,
) {
  return JSON.parse(JSON.stringify({
    schemaVersion: 2,
    task: {
      id: task.id,
      code: task.code,
      submissionRevision: task.submissionRevision,
      customerName: task.customerNameSnapshot,
      productName: task.productNameSnapshot,
      specification: task.specificationSnapshot,
    },
    entries: entries.map(entry => ({
      id: entry.id,
      kind: entry.kind,
      label: entry.label,
      payload: entry.payload,
      version: entry.version,
      reviewStatus: entry.reviewStatus,
    })),
    photos: photos.map(photo => ({
      id: photo.id,
      category: photo.category,
      caption: photo.caption,
      originalName: photo.originalName,
      mimeType: photo.mimeType,
      size: photo.size,
      sha256: photo.sha256,
      version: photo.version,
      reviewStatus: photo.reviewStatus,
    })),
  })) as Prisma.InputJsonObject;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const canReview = user.laborRole === 'ADMIN'
      || hasCapability(user.access, 'PROCESS', 'EXECUTE_WORKFLOW')
      || hasCapability(user.access, 'PRODUCT_TIME', 'EXECUTE_WORKFLOW');
    if (!canReview) throw new ForbiddenError('仅管理员或工艺流程人员可以审核样品提交包');

    const actor = sampleActor(user);
    const body = await req.json().catch(() => ({})) as JsonRecord;
    const decision = packageDecision(body.decision);
    const submissionId = cleanSampleText(body.submissionId, 80);
    const submissionRevision = Number(body.submissionRevision);
    const expectedTaskVersion = Number(body.expectedTaskVersion);
    const clientMutationId = cleanSampleText(body.clientMutationId, 100);
    const comment = cleanSampleText(body.comment, 1000);
    const edits = jsonRecord(body.edits);

    if (!decision || !submissionId || !clientMutationId) {
      return NextResponse.json({ ok: false, error: '提交包、审核动作或操作编号缺失' }, { status: 400 });
    }
    if (!Number.isInteger(submissionRevision) || submissionRevision < 1
      || !Number.isInteger(expectedTaskVersion) || expectedTaskVersion < 1) {
      return NextResponse.json({ ok: false, error: '提交包版本已失效，请刷新后重试' }, { status: 400 });
    }
    if (decision === 'REJECT' && (!comment || comment.length < 2)) {
      return NextResponse.json({ ok: false, error: '整包驳回必须填写明确原因' }, { status: 400 });
    }

    const requestHash = sampleRequestHash({
      submissionId,
      submissionRevision,
      expectedTaskVersion,
      clientMutationId,
      decision,
      comment,
      edits,
    });

    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-task:${params.id}`}))`;

      const replay = await tx.sampleSubmission.findFirst({
        where: { taskId: params.id, decisionMutationId: clientMutationId },
        select: { decisionRequestHash: true },
      });
      if (replay) {
        if (replay.decisionRequestHash !== requestHash) {
          throw new SamplePackageReviewError('相同操作编号对应了不同审核内容，请刷新后重试', 'SAMPLE_REVIEW_MUTATION_CONFLICT');
        }
        return;
      }

      const task = await tx.sampleTask.findFirst({
        where: { id: params.id, deletedAt: null },
        include: { drawingLibraryItem: { select: { id: true, specification: true } } },
      });
      if (!task) throw new SamplePackageReviewError('样品任务不存在', 'SAMPLE_TASK_NOT_FOUND', 404);
      if (task.version !== expectedTaskVersion) {
        throw new SamplePackageReviewError('样品任务已被其他人修改，请刷新后重试', 'SAMPLE_TASK_CONFLICT');
      }
      if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
        throw new SamplePackageReviewError('已完成或已取消任务仅支持查看历史', 'SAMPLE_TASK_CLOSED');
      }
      if (task.status !== 'SUBMITTED' || task.activeSubmissionId !== submissionId || task.submissionRevision !== submissionRevision) {
        throw new SamplePackageReviewError('当前提交包已撤回、已处理或不是最新版本', 'SAMPLE_SUBMISSION_NOT_ACTIVE');
      }

      const submission = await tx.sampleSubmission.findFirst({
        where: { id: submissionId, taskId: task.id, revision: submissionRevision },
      });
      if (!submission || submission.status !== 'PENDING') {
        throw new SamplePackageReviewError('当前提交包已撤回或已完成审核', 'SAMPLE_SUBMISSION_NOT_ACTIVE');
      }

      let entries = await tx.sampleDataEntry.findMany({
        where: { taskId: task.id, deletedAt: null, submissionRevision },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      let photos = await tx.samplePhoto.findMany({
        where: { taskId: task.id, deletedAt: null, submissionRevision },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      });
      const now = new Date();

      if (decision === 'EDIT') {
        const entryEdits = Array.isArray(edits.entries) ? edits.entries.map(jsonRecord) : [];
        const photoEdits = Array.isArray(edits.photos) ? edits.photos.map(jsonRecord) : [];
        if (!entryEdits.length && !photoEdits.length) {
          throw new SamplePackageReviewError('没有需要保存的修改', 'SAMPLE_REVIEW_EDIT_EMPTY', 400);
        }
        if (entryEdits.length + photoEdits.length > 300) {
          throw new SamplePackageReviewError('一次编辑的记录过多，请缩小范围', 'SAMPLE_REVIEW_EDIT_TOO_LARGE', 400);
        }

        const entryMap = new Map(entries.map(item => [item.id, item]));
        const photoMap = new Map(photos.map(item => [item.id, item]));
        const patchLog: { entries: unknown[]; photos: unknown[] } = { entries: [], photos: [] };

        for (const edit of entryEdits) {
          const id = cleanSampleText(edit.id, 80);
          const expectedVersion = Number(edit.expectedVersion);
          const entry = id ? entryMap.get(id) : null;
          if (!entry || entry.reviewStatus !== 'PENDING') {
            throw new SamplePackageReviewError('只能编辑当前提交包中的待审核记录', 'SAMPLE_REVIEW_EDIT_ITEM_INVALID');
          }
          if (!Number.isInteger(expectedVersion) || expectedVersion !== entry.version) {
            throw new SamplePackageReviewError('记录已被其他人修改，请刷新后重试', 'SAMPLE_REVIEW_EDIT_CONFLICT');
          }
          const payload = await sanitizeEntryEdit(tx, entry.kind, entry.payload, edit.payload);
          const label = own(edit, 'label') ? cleanSampleText(edit.label, 200) : entry.label;
          if (sampleRequestHash({ label, payload }) === sampleRequestHash({ label: entry.label, payload: entry.payload })) {
            continue;
          }
          const updated = await tx.sampleDataEntry.updateMany({
            where: { id: entry.id, taskId: task.id, version: entry.version, submissionRevision, reviewStatus: 'PENDING', deletedAt: null },
            data: {
              label,
              payload,
              updatedById: actor.id,
              updatedByName: actor.name,
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) throw new SamplePackageReviewError('记录已被其他人修改，请刷新后重试', 'SAMPLE_REVIEW_EDIT_CONFLICT');
          patchLog.entries.push({ id: entry.id, label, payload });
        }

        for (const edit of photoEdits) {
          const id = cleanSampleText(edit.id, 80);
          const expectedVersion = Number(edit.expectedVersion);
          const photo = id ? photoMap.get(id) : null;
          if (!photo || photo.reviewStatus !== 'PENDING') {
            throw new SamplePackageReviewError('只能编辑当前提交包中的待审核照片', 'SAMPLE_REVIEW_EDIT_ITEM_INVALID');
          }
          if (!Number.isInteger(expectedVersion) || expectedVersion !== photo.version) {
            throw new SamplePackageReviewError('照片已被其他人修改，请刷新后重试', 'SAMPLE_REVIEW_EDIT_CONFLICT');
          }
          if (own(edit, 'category') && !isSamplePhotoCategory(edit.category)) {
            throw new SamplePackageReviewError('照片分类无效，请重新选择', 'SAMPLE_REVIEW_EDIT_INVALID', 400);
          }
          const category = own(edit, 'category') ? edit.category as typeof photo.category : photo.category;
          const caption = own(edit, 'caption') ? cleanSampleText(edit.caption, 500) : photo.caption;
          if (category === photo.category && caption === photo.caption) continue;
          const updated = await tx.samplePhoto.updateMany({
            where: { id: photo.id, taskId: task.id, version: photo.version, submissionRevision, reviewStatus: 'PENDING', deletedAt: null },
            data: {
              category,
              caption,
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) throw new SamplePackageReviewError('照片已被其他人修改，请刷新后重试', 'SAMPLE_REVIEW_EDIT_CONFLICT');
          patchLog.photos.push({ id: photo.id, category, caption });
        }

        if (!patchLog.entries.length && !patchLog.photos.length) {
          throw new SamplePackageReviewError('资料没有发生变化，无需重复保存', 'SAMPLE_REVIEW_EDIT_EMPTY', 400);
        }

        entries = await tx.sampleDataEntry.findMany({
          where: { taskId: task.id, deletedAt: null, submissionRevision },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        photos = await tx.samplePhoto.findMany({
          where: { taskId: task.id, deletedAt: null, submissionRevision },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        });
        const snapshot = reviewedSnapshot(task, entries, photos);
        const submissionUpdated = await tx.sampleSubmission.updateMany({
          where: { id: submission.id, taskId: task.id, status: 'PENDING' },
          data: {
            decision: 'EDIT',
            decisionMutationId: clientMutationId,
            decisionRequestHash: requestHash,
            decisionComment: comment,
            reviewPatch: JSON.parse(JSON.stringify(patchLog)) as Prisma.InputJsonObject,
            reviewedSnapshot: snapshot,
            decidedById: actor.id,
            decidedByName: actor.name,
            decidedAt: now,
          },
        });
        if (submissionUpdated.count !== 1) throw new SamplePackageReviewError('提交包已被其他人处理', 'SAMPLE_SUBMISSION_CONFLICT');
        const taskUpdated = await tx.sampleTask.updateMany({
          where: { id: task.id, version: expectedTaskVersion, status: 'SUBMITTED', activeSubmissionId: submission.id },
          data: { dataStatus: 'PENDING_REVIEW', updatedById: actor.id, updatedByName: actor.name, version: { increment: 1 } },
        });
        if (taskUpdated.count !== 1) throw new SamplePackageReviewError('样品任务已被其他人修改，请刷新后重试', 'SAMPLE_TASK_CONFLICT');
        await tx.operationLog.create({
          data: {
            userId: actor.id,
            action: 'edit_sample_submission_package',
            targetType: 'sample_submission',
            targetId: submission.id,
            detail: { taskId: task.id, taskCode: task.code, submissionRevision, entryCount: entryEdits.length, photoCount: photoEdits.length, hasComment: Boolean(comment), clientMutationId },
          },
        });
        return;
      }

      if (decision === 'REJECT') {
        const partiallyProcessed = [...entries, ...photos].some(item => item.reviewStatus !== 'PENDING');
        if (partiallyProcessed) {
          throw new SamplePackageReviewError(
            '该历史提交包已有部分内容写入产品资料，不能伪装成整包驳回；请编辑问题后确认剩余内容',
            'SAMPLE_PACKAGE_PARTIALLY_PROCESSED',
            409,
            [{ itemType: 'submission', itemId: submission.id, title: '历史提交已部分处理', message: '可使用“编辑资料”修正，然后整包确认。' }],
          );
        }
        await Promise.all([
          tx.sampleDataEntry.updateMany({
            where: { taskId: task.id, deletedAt: null, submissionRevision, reviewStatus: 'PENDING' },
            data: { reviewStatus: 'CHANGES_REQUESTED', reviewComment: comment, reviewedById: actor.id, reviewedByName: actor.name, reviewedAt: now, version: { increment: 1 } },
          }),
          tx.samplePhoto.updateMany({
            where: { taskId: task.id, deletedAt: null, submissionRevision, reviewStatus: 'PENDING' },
            data: { reviewStatus: 'CHANGES_REQUESTED', reviewComment: comment, reviewedById: actor.id, reviewedByName: actor.name, reviewedAt: now, version: { increment: 1 } },
          }),
        ]);
        [entries, photos] = await Promise.all([
          tx.sampleDataEntry.findMany({
            where: { taskId: task.id, deletedAt: null, submissionRevision },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          }),
          tx.samplePhoto.findMany({
            where: { taskId: task.id, deletedAt: null, submissionRevision },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          }),
        ]);
        const snapshot = reviewedSnapshot(task, entries, photos);
        const submissionUpdated = await tx.sampleSubmission.updateMany({
          where: { id: submission.id, taskId: task.id, status: 'PENDING' },
          data: {
            status: 'REJECTED',
            decision: 'REJECT',
            decisionMutationId: clientMutationId,
            decisionRequestHash: requestHash,
            decisionComment: comment,
            reviewedSnapshot: snapshot,
            decidedById: actor.id,
            decidedByName: actor.name,
            decidedAt: now,
          },
        });
        if (submissionUpdated.count !== 1) throw new SamplePackageReviewError('提交包已被其他人处理', 'SAMPLE_SUBMISSION_CONFLICT');
        const taskUpdated = await tx.sampleTask.updateMany({
          where: { id: task.id, version: expectedTaskVersion, status: 'SUBMITTED', activeSubmissionId: submission.id },
          data: {
            status: 'IN_PROGRESS',
            dataStatus: 'NEEDS_CHANGES',
            activeSubmissionId: null,
            submittedAt: null,
            updatedById: actor.id,
            updatedByName: actor.name,
            version: { increment: 1 },
          },
        });
        if (taskUpdated.count !== 1) throw new SamplePackageReviewError('样品任务已被其他人修改，请刷新后重试', 'SAMPLE_TASK_CONFLICT');
        await tx.operationLog.create({
          data: {
            userId: actor.id,
            action: 'reject_sample_submission_package',
            targetType: 'sample_submission',
            targetId: submission.id,
            detail: { taskId: task.id, taskCode: task.code, submissionRevision, entryCount: entries.length, photoCount: photos.length, clientMutationId },
          },
        });
        return;
      }

      const issues: ReviewIssue[] = [];
      const resolvedProcessPayloads = new Map<string, Prisma.JsonObject>();
      const processCatalogChanges: Array<{ id: string; name: string; action: 'CREATED' | 'REACTIVATED' | 'REUSED' }> = [];
      for (const entry of entries) {
        if (entry.reviewStatus === 'CHANGES_REQUESTED' || entry.reviewStatus === 'VOIDED' || entry.reviewStatus === 'DRAFT') {
          issues.push({ itemType: 'entry', itemId: entry.id, title: entry.label || entry.kind, message: '记录不属于可确认状态，请先编辑或重新提交。' });
          continue;
        }
        if (entry.reviewStatus !== 'PENDING' || entry.kind !== 'PROCESS_TIME') continue;
        const payload = jsonRecord(entry.payload);
        const processDefinitionId = cleanSampleText(payload.processDefinitionId, 80);
        const processName = cleanSampleText(payload.processName, 60);
        if (!processDefinitionId && !processName) {
          issues.push({ itemType: 'entry', itemId: entry.id, title: entry.label || '工序工时', message: '缺少工序名称，无法自动收录到工序库。' });
        }
        if (processSeconds(entry.payload) === null) {
          issues.push({ itemType: 'entry', itemId: entry.id, title: processName || entry.label || '工序工时', message: '缺少有效工时。' });
        }
      }
      const processIds = [...new Set(entries
        .filter(entry => entry.kind === 'PROCESS_TIME' && entry.reviewStatus === 'PENDING')
        .map(entry => cleanSampleText(jsonRecord(entry.payload).processDefinitionId, 80))
        .filter((value): value is string => Boolean(value)))];
      // Active ids are resolved in one query below. A stale id may fall back
      // to its captured name so historic submissions are not stuck.
      const activeDefinitions = processIds.length
        ? await tx.processDefinition.findMany({ where: { id: { in: processIds }, isActive: true } })
        : [];
      const activeDefinitionById = new Map(activeDefinitions.map(item => [item.id, item]));
      const catalogLogged = new Set<string>();
      for (const entry of entries) {
        if (entry.kind !== 'PROCESS_TIME' || entry.reviewStatus !== 'PENDING') continue;
        const payload = jsonRecord(entry.payload);
        const processDefinitionId = cleanSampleText(payload.processDefinitionId, 80);
        const processName = cleanSampleText(payload.processName, 60);
        if ((!processDefinitionId && !processName) || processSeconds(entry.payload) === null) continue;
        try {
          const activeDefinition = processDefinitionId ? activeDefinitionById.get(processDefinitionId) : null;
          const resolution = activeDefinition
            ? { definition: activeDefinition, action: 'REUSED' as const }
            : await resolveOrCreateProcessDefinition(tx, {
                name: processName,
                stageGroup: payload.stageGroup,
              });
          const resolvedPayload = JSON.parse(JSON.stringify({
            ...payload,
            processDefinitionId: resolution.definition.id,
            processName: resolution.definition.name,
            processOrigin: 'MASTER',
            stageGroup: resolution.definition.stageGroup,
            mappedByReview: true,
            ...(processName && processName !== resolution.definition.name ? { mappedFromProcessName: processName } : {}),
          })) as Prisma.JsonObject;
          resolvedProcessPayloads.set(entry.id, resolvedPayload);
          processCatalogChanges.push({ id: resolution.definition.id, name: resolution.definition.name, action: resolution.action });
          if (resolution.action !== 'REUSED' && !catalogLogged.has(resolution.definition.id)) {
            catalogLogged.add(resolution.definition.id);
            await tx.operationLog.create({
              data: {
                userId: actor.id,
                action: resolution.action === 'CREATED'
                  ? 'create_process_definition_from_sample'
                  : 'reactivate_process_definition_from_sample',
                targetType: 'process_definition',
                targetId: resolution.definition.id,
                detail: {
                  processCode: resolution.definition.code,
                  processName: resolution.definition.name,
                  sampleTaskId: task.id,
                  sampleSubmissionId: submission.id,
                  sourceEntryId: entry.id,
                },
              },
            });
          }
        } catch (error) {
          if (error instanceof ProcessDefinitionResolutionError) {
            issues.push({ itemType: 'entry', itemId: entry.id, title: processName || entry.label || '工序工时', message: error.message });
            continue;
          }
          throw error;
        }
      }
      for (const photo of photos) {
        if (photo.reviewStatus === 'CHANGES_REQUESTED' || photo.reviewStatus === 'VOIDED' || photo.reviewStatus === 'DRAFT') {
          issues.push({ itemType: 'photo', itemId: photo.id, title: photo.caption || photo.originalName, message: '照片不属于可确认状态，请先编辑或重新提交。' });
        }
      }
      const categoryCodes = [...new Set(photos.filter(photo => photo.reviewStatus === 'PENDING').map(photo => photoCategoryCode(photo.category)))];
      if (categoryCodes.length) {
        const categories = await tx.resourceCategory.findMany({ where: { code: { in: categoryCodes } }, select: { code: true } });
        const availableCodes = new Set(categories.map(item => item.code));
        for (const code of categoryCodes) {
          if (!availableCodes.has(code)) {
            issues.push({ itemType: 'submission', itemId: submission.id, title: '资料分类未初始化', message: `缺少资料分类 ${code}，请联系管理员。` });
          }
        }
      }
      if (issues.length) {
        throw new SamplePackageReviewError('提交包还有阻断项，请编辑后再确认', 'SAMPLE_PACKAGE_NOT_READY', 409, issues);
      }

      let publishedEntries = 0;
      let recordedEntries = 0;
      let publishedPhotos = 0;
      for (const entry of entries) {
        if (entry.reviewStatus !== 'PENDING') continue;
        const resolvedProcessPayload = resolvedProcessPayloads.get(entry.id);
        const resolvedPayload = resolvedProcessPayload || entry.payload;
        const publishMode = hasMeaningfulBusinessValue(entry.kind, entry.label, resolvedPayload) ? 'APPEND' : 'RECORD_ONLY';
        const publication = await publishSampleEntry(tx, task, { ...entry, payload: resolvedPayload }, actor, publishMode);
        const updated = await tx.sampleDataEntry.updateMany({
          where: { id: entry.id, taskId: task.id, version: entry.version, submissionRevision, reviewStatus: 'PENDING', deletedAt: null },
          data: {
            ...(resolvedProcessPayload ? { payload: resolvedProcessPayload } : {}),
            reviewStatus: publication.reviewStatus,
            publishMode,
            reviewComment: comment,
            reviewedById: actor.id,
            reviewedByName: actor.name,
            reviewedAt: now,
            publishedEntityType: publication.entityType,
            publishedEntityId: publication.entityId,
            publishedAt: publication.entityId ? now : null,
            publishedById: publication.entityId ? actor.id : null,
            publishedByName: publication.entityId ? actor.name : null,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new SamplePackageReviewError('记录已被其他人修改，请刷新后重试', 'SAMPLE_REVIEW_EDIT_CONFLICT');
        if (publication.entityId) publishedEntries += 1;
        else recordedEntries += 1;
      }

      for (const photo of photos) {
        if (photo.reviewStatus !== 'PENDING') continue;
        await publishSamplePhoto(tx, task, photo, actor, { deferLifecycleSync: true });
        const updated = await tx.samplePhoto.updateMany({
          where: { id: photo.id, taskId: task.id, version: photo.version, submissionRevision, reviewStatus: 'PENDING', deletedAt: null },
          data: {
            reviewStatus: 'PUBLISHED',
            reviewComment: comment,
            reviewedById: actor.id,
            reviewedByName: actor.name,
            reviewedAt: now,
            publishedAt: now,
            publishedById: actor.id,
            publishedByName: actor.name,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new SamplePackageReviewError('照片已被其他人修改，请刷新后重试', 'SAMPLE_REVIEW_EDIT_CONFLICT');
        publishedPhotos += 1;
      }
      if (publishedPhotos > 0) await finalizeSamplePhotoPublication(tx, task.drawingLibraryItemId);

      entries = await tx.sampleDataEntry.findMany({
        where: { taskId: task.id, deletedAt: null, submissionRevision },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      photos = await tx.samplePhoto.findMany({
        where: { taskId: task.id, deletedAt: null, submissionRevision },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      });
      const snapshot = reviewedSnapshot(task, entries, photos);
      const submissionUpdated = await tx.sampleSubmission.updateMany({
        where: { id: submission.id, taskId: task.id, status: 'PENDING' },
        data: {
          status: 'CONFIRMED',
          decision: 'CONFIRM',
          decisionMutationId: clientMutationId,
          decisionRequestHash: requestHash,
          decisionComment: comment,
          reviewedSnapshot: snapshot,
          decidedById: actor.id,
          decidedByName: actor.name,
          decidedAt: now,
        },
      });
      if (submissionUpdated.count !== 1) throw new SamplePackageReviewError('提交包已被其他人处理', 'SAMPLE_SUBMISSION_CONFLICT');
      const taskUpdated = await tx.sampleTask.updateMany({
        where: { id: task.id, version: expectedTaskVersion, status: 'SUBMITTED', activeSubmissionId: submission.id },
        data: {
          status: 'COMPLETED',
          dataStatus: 'PROCESSED',
          activeSubmissionId: null,
          acceptedSubmissionId: submission.id,
          submittedAt: null,
          completedAt: now,
          archivedAt: now,
          archivedById: actor.id,
          archivedByName: actor.name,
          archiveReason: '整包审核确认后自动归档',
          updatedById: actor.id,
          updatedByName: actor.name,
          version: { increment: 1 },
        },
      });
      if (taskUpdated.count !== 1) throw new SamplePackageReviewError('样品任务已被其他人修改，请刷新后重试', 'SAMPLE_TASK_CONFLICT');
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'confirm_sample_submission_package',
          targetType: 'sample_submission',
          targetId: submission.id,
          detail: {
            taskId: task.id,
            taskCode: task.code,
            submissionRevision,
            entryCount: entries.length,
            photoCount: photos.length,
            publishedEntries,
            recordedEntries,
            publishedPhotos,
            processCatalogChanges,
            clientMutationId,
          },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 });

    const task = await prisma.sampleTask.findUnique({ where: { id: params.id }, include: sampleTaskInclude });
    return NextResponse.json({ ok: true, task: task ? serializeSampleTask(task) : null });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden(error.message);
    if (error instanceof SamplePackageReviewError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code, issues: error.issues }, { status: error.status });
    }
    if (error instanceof SamplePublishError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ ok: false, error: '该提交包已经处理，请刷新查看结果', code: 'SAMPLE_PACKAGE_ALREADY_PROCESSED' }, { status: 409 });
    }
    if ((error as { code?: string }).code === 'P2034') {
      return NextResponse.json({ ok: false, error: '提交包正在被其他人处理，请刷新后重试', code: 'SAMPLE_PACKAGE_CONFLICT' }, { status: 409 });
    }
    console.error('review sample submission package failed', error);
    return NextResponse.json({ ok: false, error: '样品提交包审核失败' }, { status: 500 });
  }
}
