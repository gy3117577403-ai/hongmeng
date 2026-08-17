import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
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

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const actor = sampleActor(user);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const itemType = body.itemType === 'photo' ? 'photo' : body.itemType === 'entry' ? 'entry' : null;
    const itemId = cleanSampleText(body.itemId, 80);
    const reviewDecision = decision(body.decision);
    const expectedVersion = Number(body.expectedVersion);
    if (!itemType || !itemId || !reviewDecision) {
      return NextResponse.json({ ok: false, error: '请选择需要审核的数据和处理方式' }, { status: 400 });
    }
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
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
          const publication = await publishSampleEntry(tx, task, entry, actor, publishMode);
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
      await tx.sampleTask.update({
        where: { id: task.id },
        data: { updatedById: actor.id, updatedByName: actor.name, version: { increment: 1 } },
      });
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
    if (error instanceof SamplePublishError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof Error) {
      if (error.message === 'SAMPLE_TASK_NOT_FOUND') return NextResponse.json({ ok: false, error: '样品任务不存在' }, { status: 404 });
      if (error.message === 'SAMPLE_REVIEW_ITEM_NOT_FOUND') return NextResponse.json({ ok: false, error: '审核数据不存在' }, { status: 404 });
      if (error.message === 'SAMPLE_REVIEW_CONFLICT') return NextResponse.json({ ok: false, error: '审核数据已被其他人处理，请刷新后重试' }, { status: 409 });
      if (error.message === 'SAMPLE_REVIEW_STATE_INVALID') return NextResponse.json({ ok: false, error: '只有待审核数据可以处理' }, { status: 409 });
      if (error.message === 'SAMPLE_REVIEW_ALREADY_PUBLISHED') return NextResponse.json({ ok: false, error: '该数据已经发布，不能重复覆盖' }, { status: 409 });
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
