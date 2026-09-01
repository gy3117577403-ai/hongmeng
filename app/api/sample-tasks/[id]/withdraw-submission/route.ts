import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  cleanSampleText,
  refreshSampleTaskDataStatus,
  sampleActor,
  sampleRequestHash,
  sampleTaskInclude,
  serializeSampleTask,
} from '@/lib/sample-team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const actor = sampleActor(user);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const expectedVersion = Number(body.expectedVersion);
    const reason = cleanSampleText(body.reason, 500);
    const clientMutationId = cleanSampleText(body.clientMutationId, 80);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return NextResponse.json({ ok: false, error: '样品任务版本已失效，请刷新后重试' }, { status: 400 });
    }

    const requestHash = clientMutationId ? sampleRequestHash({ expectedVersion, reason, clientMutationId }) : null;
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-task:${params.id}`}))`;
      const task = await tx.sampleTask.findFirst({ where: { id: params.id, deletedAt: null } });
      if (!task) throw new Error('SAMPLE_TASK_NOT_FOUND');
      if (clientMutationId) {
        const replay = await tx.sampleSubmission.findUnique({
          where: { taskId_withdrawalMutationId: { taskId: task.id, withdrawalMutationId: clientMutationId } },
        });
        if (replay) {
          if (replay.withdrawalRequestHash !== requestHash) throw new Error('SAMPLE_MUTATION_CONFLICT');
          return;
        }
      }
      if (task.version !== expectedVersion) throw new Error('SAMPLE_TASK_CONFLICT');
      if (task.status !== 'SUBMITTED' || !task.activeSubmissionId) throw new Error('SAMPLE_TASK_NOT_SUBMITTED');
      const submission = await tx.sampleSubmission.findFirst({
        where: { id: task.activeSubmissionId, taskId: task.id, status: 'PENDING' },
      });
      if (!submission) throw new Error('SAMPLE_SUBMISSION_NOT_ACTIVE');
      const [allEntries, pendingEntries, allPhotos, pendingPhotos] = await Promise.all([
        tx.sampleDataEntry.count({ where: { taskId: task.id, deletedAt: null, submissionRevision: submission.revision } }),
        tx.sampleDataEntry.count({ where: { taskId: task.id, deletedAt: null, submissionRevision: submission.revision, reviewStatus: 'PENDING' } }),
        tx.samplePhoto.count({ where: { taskId: task.id, deletedAt: null, submissionRevision: submission.revision } }),
        tx.samplePhoto.count({ where: { taskId: task.id, deletedAt: null, submissionRevision: submission.revision, reviewStatus: 'PENDING' } }),
      ]);
      if (allEntries + allPhotos === 0) throw new Error('SAMPLE_SUBMISSION_EMPTY');
      if (allEntries !== pendingEntries || allPhotos !== pendingPhotos) throw new Error('SAMPLE_SUBMISSION_REVIEW_STARTED');

      await Promise.all([
        tx.sampleDataEntry.updateMany({
          where: { taskId: task.id, deletedAt: null, submissionRevision: submission.revision, reviewStatus: 'PENDING' },
          data: { reviewStatus: 'DRAFT', version: { increment: 1 } },
        }),
        tx.samplePhoto.updateMany({
          where: { taskId: task.id, deletedAt: null, submissionRevision: submission.revision, reviewStatus: 'PENDING' },
          data: { reviewStatus: 'DRAFT', version: { increment: 1 } },
        }),
      ]);
      await tx.sampleSubmission.update({
        where: { id: submission.id },
        data: {
          status: 'WITHDRAWN',
          withdrawnById: actor.id,
          withdrawnByName: actor.name,
          withdrawnAt: new Date(),
          withdrawalReason: reason,
          withdrawalMutationId: clientMutationId,
          withdrawalRequestHash: requestHash,
        },
      });
      const updated = await tx.sampleTask.updateMany({
        where: { id: task.id, version: expectedVersion, activeSubmissionId: submission.id },
        data: {
          status: 'IN_PROGRESS',
          activeSubmissionId: null,
          submittedAt: null,
          updatedById: actor.id,
          updatedByName: actor.name,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new Error('SAMPLE_TASK_CONFLICT');
      await refreshSampleTaskDataStatus(tx, task.id);
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'withdraw_sample_submission',
          targetType: 'sample_submission',
          targetId: submission.id,
          detail: { taskId: task.id, taskCode: task.code, submissionRevision: submission.revision, reason, clientMutationId, requestHash },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const task = await prisma.sampleTask.findUnique({ where: { id: params.id }, include: sampleTaskInclude });
    return NextResponse.json({ ok: true, task: task ? serializeSampleTask(task) : null });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error) {
      if (error.message === 'SAMPLE_TASK_NOT_FOUND') return NextResponse.json({ ok: false, error: '样品任务不存在' }, { status: 404 });
      if (error.message === 'SAMPLE_TASK_CONFLICT') return NextResponse.json({ ok: false, error: '样品任务已被其他人修改，请刷新后重试' }, { status: 409 });
      if (error.message === 'SAMPLE_TASK_NOT_SUBMITTED' || error.message === 'SAMPLE_SUBMISSION_NOT_ACTIVE') return NextResponse.json({ ok: false, error: '当前没有可撤回的提交' }, { status: 409 });
      if (error.message === 'SAMPLE_SUBMISSION_REVIEW_STARTED') return NextResponse.json({ ok: false, error: '审核已经开始，不能自行撤回，请联系审核人员退回' }, { status: 409 });
      if (error.message === 'SAMPLE_SUBMISSION_EMPTY') return NextResponse.json({ ok: false, error: '提交版本没有活动数据，请联系管理员处理' }, { status: 409 });
      if (error.message === 'SAMPLE_MUTATION_CONFLICT') return NextResponse.json({ ok: false, error: '同一撤回编号对应了不同请求，请刷新后重试' }, { status: 409 });
    }
    console.error('withdraw sample submission failed', error);
    return NextResponse.json({ ok: false, error: '撤回提交失败' }, { status: 500 });
  }
}
