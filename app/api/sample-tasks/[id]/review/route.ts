import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { ForbiddenError, forbidden, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { hasCapability } from '@/lib/department-access';
import { prisma } from '@/lib/prisma';
import {
  cleanSampleText,
  isSamplePhotoCategory,
  isSamplePublishMode,
  refreshSampleTaskDataStatus,
  sampleActor,
  sampleTaskInclude,
  serializeSampleTask,
} from '@/lib/sample-team';
import {
  publishSampleEntry,
  publishSamplePhoto,
  SamplePublishError,
} from '@/lib/sample-team-publish';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ReviewDecision = 'PUBLISH' | 'APPROVE' | 'CHANGES_REQUESTED' | 'VOID';

function decision(value: unknown): ReviewDecision | null {
  return value === 'PUBLISH' || value === 'APPROVE' || value === 'CHANGES_REQUESTED' || value === 'VOID'
    ? value
    : null;
}

function processStageGroup(value: unknown): 'frontend' | 'backend' | 'finish' {
  return value === 'backend' || value === 'finish' ? value : 'frontend';
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const canReview = user.laborRole === 'ADMIN'
      || hasCapability(user.access, 'PROCESS', 'EXECUTE_WORKFLOW')
      || hasCapability(user.access, 'PRODUCT_TIME', 'EXECUTE_WORKFLOW');
    if (!canReview) throw new ForbiddenError('仅管理员或工艺流程人员可以审核样品采集内容');
    const canCreateProcessDefinition = user.laborRole === 'ADMIN'
      || hasCapability(user.access, 'PROCESS', 'EXECUTE_WORKFLOW');
    const actor = sampleActor(user);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const itemType = body.itemType === 'photo' ? 'photo' : body.itemType === 'entry' ? 'entry' : null;
    const itemId = cleanSampleText(body.itemId, 80);
    const reviewDecision = decision(body.decision);
    const expectedVersion = Number(body.expectedVersion);
    const expectedTaskVersion = Number(body.expectedTaskVersion);
    if (!itemType || !itemId || !reviewDecision) {
      return NextResponse.json({ ok: false, error: '请选择需要审核的数据和处理方式' }, { status: 400 });
    }
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1 || !Number.isInteger(expectedTaskVersion) || expectedTaskVersion < 1) {
      return NextResponse.json({ ok: false, error: '审核数据版本已失效，请刷新后重试' }, { status: 400 });
    }
    const publishMode = isSamplePublishMode(body.publishMode) ? body.publishMode : 'APPEND';
    const comment = cleanSampleText(body.comment, 1000);
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-task:${params.id}`}))`;
      const task = await tx.sampleTask.findFirst({
        where: { id: params.id, deletedAt: null },
        include: { drawingLibraryItem: { select: { id: true, specification: true } } },
      });
      if (!task) throw new Error('SAMPLE_TASK_NOT_FOUND');
      if (task.version !== expectedTaskVersion) throw new Error('SAMPLE_TASK_CONFLICT');
      if (task.status === 'CANCELLED' || task.status === 'COMPLETED') throw new Error('SAMPLE_TASK_CLOSED');
      const now = new Date();
      let detail: Record<string, unknown> = { itemType, itemId, reviewDecision, publishMode };
      if (itemType === 'entry') {
        const entry = await tx.sampleDataEntry.findFirst({ where: { id: itemId, taskId: task.id, deletedAt: null } });
        if (!entry) throw new Error('SAMPLE_REVIEW_ITEM_NOT_FOUND');
        if (entry.version !== expectedVersion) throw new Error('SAMPLE_REVIEW_CONFLICT');
        if (!['PENDING', 'APPROVED'].includes(entry.reviewStatus)) throw new Error('SAMPLE_REVIEW_STATE_INVALID');
        if (entry.reviewStatus === 'PUBLISHED' || entry.publishedEntityId) {
          throw new Error('SAMPLE_REVIEW_ALREADY_PUBLISHED');
        }

        let reviewStatus: 'APPROVED' | 'PUBLISHED' | 'CHANGES_REQUESTED' | 'VOIDED';
        let publishedEntityType: string | null = entry.publishedEntityType;
        let publishedEntityId: string | null = entry.publishedEntityId;
        let publishedAt = entry.publishedAt;
        let publishedById = entry.publishedById;
        let publishedByName = entry.publishedByName;
        let reviewedPayload = JSON.parse(JSON.stringify(entry.payload)) as Prisma.InputJsonObject;
        if (reviewDecision === 'CHANGES_REQUESTED') {
          reviewStatus = 'CHANGES_REQUESTED';
          publishedEntityType = null;
          publishedEntityId = null;
          publishedAt = null;
          publishedById = null;
          publishedByName = null;
        } else if (reviewDecision === 'VOID') {
          reviewStatus = 'VOIDED';
        } else if (reviewDecision === 'APPROVE') {
          reviewStatus = 'APPROVED';
        } else {
          let entryForPublish = entry;
          if (entry.kind === 'PROCESS_TIME') {
            const currentPayload = entry.payload && typeof entry.payload === 'object' && !Array.isArray(entry.payload)
              ? entry.payload as Record<string, unknown>
              : {};
            const requestedProcessDefinitionId = cleanSampleText(body.processDefinitionId, 80);
            const storedProcessDefinitionId = cleanSampleText(currentPayload.processDefinitionId, 80);
            const selectedProcessDefinitionId = requestedProcessDefinitionId || storedProcessDefinitionId;
            let processDefinition: { id: string; name: string } | null = selectedProcessDefinitionId
              ? await tx.processDefinition.findFirst({
                where: { id: selectedProcessDefinitionId, isActive: true },
                select: { id: true, name: true },
              })
              : null;
            let createdProcessDefinition = false;
            if (!processDefinition && body.createProcessDefinition === true) {
              if (!canCreateProcessDefinition) throw new Error('SAMPLE_PROCESS_CREATE_FORBIDDEN');
              const candidateName = cleanSampleText(currentPayload.processName, 120);
              if (!candidateName) throw new Error('SAMPLE_PROCESS_MAPPING_REQUIRED');
              if (candidateName.length > 60) throw new Error('SAMPLE_PROCESS_NAME_TOO_LONG');
              const sameName = await tx.processDefinition.findFirst({
                where: { name: { equals: candidateName, mode: 'insensitive' } },
                select: { id: true, name: true, isActive: true },
              });
              if (sameName && !sameName.isActive) throw new Error('SAMPLE_PROCESS_DUPLICATE_INACTIVE');
              if (sameName) {
                processDefinition = { id: sameName.id, name: sameName.name };
              } else {
                const created = await tx.processDefinition.create({
                  data: {
                    code: `process-${randomUUID()}`,
                    name: candidateName,
                    stageGroup: processStageGroup(body.processStageGroup),
                    sortOrder: 1000,
                    isActive: true,
                  },
                  select: { id: true, name: true },
                });
                processDefinition = created;
                createdProcessDefinition = true;
                await tx.operationLog.create({
                  data: {
                    userId: actor.id,
                    action: 'create_process_definition_from_sample_review',
                    targetType: 'process_definition',
                    targetId: created.id,
                    detail: {
                      taskId: task.id,
                      sampleEntryId: entry.id,
                      processName: created.name,
                      stageGroup: processStageGroup(body.processStageGroup),
                    },
                  },
                });
              }
            }
            if (!processDefinition) {
              if (requestedProcessDefinitionId || storedProcessDefinitionId) throw new Error('SAMPLE_PROCESS_NOT_FOUND');
              throw new Error('SAMPLE_PROCESS_MAPPING_REQUIRED');
            }
            reviewedPayload = {
              ...currentPayload,
              processDefinitionId: processDefinition.id,
              processName: processDefinition.name,
              processOrigin: 'MASTER',
              mappedFromProcessName: cleanSampleText(currentPayload.processName, 120),
              mappedByReview: true,
            } as Prisma.InputJsonObject;
            entryForPublish = { ...entry, payload: reviewedPayload as Prisma.JsonObject };
            detail = {
              ...detail,
              mappedProcessDefinitionId: processDefinition.id,
              mappedProcessName: processDefinition.name,
              mappedCandidate: !cleanSampleText(currentPayload.processDefinitionId, 80),
              createdProcessDefinition,
            };
          }
          const publication = await publishSampleEntry(tx, task, entryForPublish, actor, publishMode);
          reviewStatus = publication.reviewStatus;
          publishedEntityType = publication.entityType;
          publishedEntityId = publication.entityId;
          publishedAt = now;
          publishedById = actor.id;
          publishedByName = actor.name;
          detail = { ...detail, ...publication.detail, entityType: publication.entityType, entityId: publication.entityId };
        }
        const updated = await tx.sampleDataEntry.updateMany({
          where: { id: entry.id, version: expectedVersion },
          data: {
            reviewStatus,
            payload: reviewedPayload,
            publishMode: reviewDecision === 'PUBLISH' ? publishMode : reviewDecision === 'APPROVE' ? 'RECORD_ONLY' : entry.publishMode,
            reviewComment: comment,
            reviewedById: actor.id,
            reviewedByName: actor.name,
            reviewedAt: now,
            publishedEntityType,
            publishedEntityId,
            publishedAt,
            publishedById,
            publishedByName,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new Error('SAMPLE_REVIEW_CONFLICT');
      } else {
        const photo = await tx.samplePhoto.findFirst({ where: { id: itemId, taskId: task.id, deletedAt: null } });
        if (!photo) throw new Error('SAMPLE_REVIEW_ITEM_NOT_FOUND');
        if (photo.version !== expectedVersion) throw new Error('SAMPLE_REVIEW_CONFLICT');
        if (!['PENDING', 'APPROVED'].includes(photo.reviewStatus)) throw new Error('SAMPLE_REVIEW_STATE_INVALID');
        if (photo.reviewStatus === 'PUBLISHED' || photo.publishedFileId) throw new Error('SAMPLE_REVIEW_ALREADY_PUBLISHED');
        const category = isSamplePhotoCategory(body.category) ? body.category : photo.category;
        let reviewStatus: 'APPROVED' | 'PUBLISHED' | 'CHANGES_REQUESTED' | 'VOIDED';
        let publishedAt = photo.publishedAt;
        let publishedById = photo.publishedById;
        let publishedByName = photo.publishedByName;
        if (reviewDecision === 'CHANGES_REQUESTED') {
          reviewStatus = 'CHANGES_REQUESTED';
        } else if (reviewDecision === 'VOID') {
          reviewStatus = 'VOIDED';
        } else if (reviewDecision === 'APPROVE') {
          reviewStatus = 'APPROVED';
        } else {
          const photoForPublish = category === photo.category ? photo : { ...photo, category };
          const publication = await publishSamplePhoto(tx, task, photoForPublish, actor);
          reviewStatus = 'PUBLISHED';
          publishedAt = now;
          publishedById = actor.id;
          publishedByName = actor.name;
          detail = { ...detail, ...publication.detail, entityType: publication.entityType, entityId: publication.entityId, category };
        }
        const updated = await tx.samplePhoto.updateMany({
          where: { id: photo.id, version: expectedVersion },
          data: {
            category,
            reviewStatus,
            reviewComment: comment,
            reviewedById: actor.id,
            reviewedByName: actor.name,
            reviewedAt: now,
            publishedAt,
            publishedById,
            publishedByName,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new Error('SAMPLE_REVIEW_CONFLICT');
      }
      let releaseSubmission = false;
      if (reviewDecision === 'CHANGES_REQUESTED' && task.activeSubmissionId) {
        await Promise.all([
          tx.sampleDataEntry.updateMany({
            where: { taskId: task.id, deletedAt: null, submissionRevision: task.submissionRevision, reviewStatus: 'PENDING' },
            data: { reviewStatus: 'CHANGES_REQUESTED', reviewComment: '同一提交版本存在退回项，请一并确认后重新提交', version: { increment: 1 } },
          }),
          tx.samplePhoto.updateMany({
            where: { taskId: task.id, deletedAt: null, submissionRevision: task.submissionRevision, reviewStatus: 'PENDING' },
            data: { reviewStatus: 'CHANGES_REQUESTED', reviewComment: '同一提交版本存在退回项，请一并确认后重新提交', version: { increment: 1 } },
          }),
          tx.sampleSubmission.updateMany({
            where: { id: task.activeSubmissionId, taskId: task.id, status: 'PENDING' },
            data: { status: 'CHANGES_REQUESTED' },
          }),
        ]);
        releaseSubmission = true;
      } else if (task.activeSubmissionId) {
        const remainingPending = await tx.sampleDataEntry.count({
          where: { taskId: task.id, deletedAt: null, submissionRevision: task.submissionRevision, reviewStatus: 'PENDING' },
        }) + await tx.samplePhoto.count({
          where: { taskId: task.id, deletedAt: null, submissionRevision: task.submissionRevision, reviewStatus: 'PENDING' },
        });
        if (remainingPending === 0) {
          await tx.sampleSubmission.updateMany({
            where: { id: task.activeSubmissionId, taskId: task.id, status: 'PENDING' },
            data: { status: 'REVIEWED' },
          });
          releaseSubmission = true;
        }
      }
      const taskUpdated = await tx.sampleTask.updateMany({
        where: { id: task.id, version: expectedTaskVersion },
        data: {
          ...(releaseSubmission ? { status: 'IN_PROGRESS', activeSubmissionId: null, submittedAt: null } : {}),
          updatedById: actor.id,
          updatedByName: actor.name,
          version: { increment: 1 },
        },
      });
      if (taskUpdated.count !== 1) throw new Error('SAMPLE_TASK_CONFLICT');
      await refreshSampleTaskDataStatus(tx, task.id);
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: `review_sample_${itemType}`,
          targetType: itemType === 'entry' ? 'sample_data_entry' : 'sample_photo',
          targetId: itemId,
          detail: { taskId: task.id, taskCode: task.code, ...detail, hasComment: Boolean(comment) },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const task = await prisma.sampleTask.findUnique({ where: { id: params.id }, include: sampleTaskInclude });
    return NextResponse.json({ ok: true, task: task ? serializeSampleTask(task) : null });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden(error.message);
    if (error instanceof SamplePublishError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof Error) {
      if (error.message === 'SAMPLE_TASK_NOT_FOUND') return NextResponse.json({ ok: false, error: '样品任务不存在' }, { status: 404 });
      if (error.message === 'SAMPLE_TASK_CONFLICT') return NextResponse.json({ ok: false, error: '样品任务已被其他人修改，请刷新后重试' }, { status: 409 });
      if (error.message === 'SAMPLE_TASK_CLOSED') return NextResponse.json({ ok: false, error: '已完成或已取消任务不能继续审核' }, { status: 409 });
      if (error.message === 'SAMPLE_REVIEW_ITEM_NOT_FOUND') return NextResponse.json({ ok: false, error: '审核数据不存在' }, { status: 404 });
      if (error.message === 'SAMPLE_REVIEW_CONFLICT') return NextResponse.json({ ok: false, error: '审核数据已被其他人处理，请刷新后重试' }, { status: 409 });
      if (error.message === 'SAMPLE_REVIEW_STATE_INVALID') return NextResponse.json({ ok: false, error: '只有待审核数据可以处理' }, { status: 409 });
      if (error.message === 'SAMPLE_REVIEW_ALREADY_PUBLISHED') return NextResponse.json({ ok: false, error: '该数据已经发布，不能重复覆盖' }, { status: 409 });
      if (error.message === 'SAMPLE_PROCESS_MAPPING_REQUIRED') return NextResponse.json({ ok: false, error: '候选工序必须先映射到正式工序，才能发布到产品工时草稿' }, { status: 409 });
      if (error.message === 'SAMPLE_PROCESS_NOT_FOUND') return NextResponse.json({ ok: false, error: '映射的正式工序已停用或不存在，请重新选择' }, { status: 409 });
      if (error.message === 'SAMPLE_PROCESS_CREATE_FORBIDDEN') return NextResponse.json({ ok: false, error: '当前账号可以审核，但无权新增正式工序；请选择已有工序或交由工艺管理员处理' }, { status: 403 });
      if (error.message === 'SAMPLE_PROCESS_NAME_TOO_LONG') return NextResponse.json({ ok: false, error: '候选工序名称超过 60 个字符，请先退回精简名称' }, { status: 400 });
      if (error.message === 'SAMPLE_PROCESS_DUPLICATE_INACTIVE') return NextResponse.json({ ok: false, error: '存在同名停用工序，请先在工序库恢复后再映射' }, { status: 409 });
    }
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ ok: false, error: '该样品数据已经发布，请刷新查看结果' }, { status: 409 });
    }
    if ((error as { code?: string }).code === 'P2034') {
      return NextResponse.json({ ok: false, error: '审核数据正在被其他人处理，请刷新后重试' }, { status: 409 });
    }
    console.error('review sample item failed', error);
    return NextResponse.json({ ok: false, error: '样品数据审核失败' }, { status: 500 });
  }
}
