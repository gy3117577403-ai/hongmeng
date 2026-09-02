import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { sampleCustomerLevel } from '@/lib/sample-customer-levels';
import {
  cleanSampleText,
  parseOptionalNonNegativeInteger,
  parseOptionalSampleDate,
  sampleActor,
  sampleDraftSectionHasData,
  sampleDraftSectionHasUnsubmittedChange,
  sampleTaskInclude,
  serializeSampleTask,
} from '@/lib/sample-team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function ids(value: unknown): string[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => cleanSampleText(item, 80)).filter((item): item is string => Boolean(item)))].slice(0, 30);
}
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const task = await prisma.sampleTask.findFirst({
      where: { id: params.id, deletedAt: null },
      include: sampleTaskInclude,
    });
    if (!task) return NextResponse.json({ ok: false, error: '样品任务不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, task: serializeSampleTask(task) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('sample task detail failed', error);
    return NextResponse.json({ ok: false, error: '样品任务加载失败' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const actor = sampleActor(user);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return NextResponse.json({ ok: false, error: '样品任务版本已失效，请刷新后重试' }, { status: 400 });
    }
    const action = cleanSampleText(body.action, 30) || 'UPDATE';
    if (!['UPDATE', 'START', 'COMPLETE', 'CANCEL', 'ARCHIVE', 'UNARCHIVE'].includes(action)) {
      return NextResponse.json({ ok: false, error: '不支持的样品任务操作' }, { status: 400 });
    }
    const assigneeIds = ids(body.assigneeEmployeeIds);
    const now = new Date();
    const resultId = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-task:${params.id}`}))`;
      const existing = await tx.sampleTask.findFirst({ where: { id: params.id, deletedAt: null } });
      if (!existing) throw new Error('SAMPLE_TASK_NOT_FOUND');
      if (existing.version !== expectedVersion) throw new Error('SAMPLE_TASK_CONFLICT');
      let status = existing.status;
      const lifecycle: Prisma.SampleTaskUncheckedUpdateInput = {};
      let noDataCompletion = false;
      if (action === 'START') {
        if (status === 'CANCELLED' || status === 'COMPLETED') throw new Error('SAMPLE_TASK_CLOSED');
        if (status === 'SUBMITTED' || existing.activeSubmissionId) throw new Error('SAMPLE_TASK_SUBMITTED');
        status = 'IN_PROGRESS';
        lifecycle.startedAt = existing.startedAt || now;
      } else if (action === 'COMPLETE') {
        if (status === 'CANCELLED' || status === 'COMPLETED') throw new Error('SAMPLE_TASK_CLOSED');
        {
          const [blockingEntries, blockingPhotos, totalEntries, totalPhotos, sections] = await Promise.all([
            tx.sampleDataEntry.count({ where: { taskId: existing.id, deletedAt: null, reviewStatus: { in: ['DRAFT', 'PENDING', 'CHANGES_REQUESTED'] } } }),
            tx.samplePhoto.count({ where: { taskId: existing.id, deletedAt: null, reviewStatus: { in: ['DRAFT', 'PENDING', 'CHANGES_REQUESTED'] } } }),
            tx.sampleDataEntry.count({ where: { taskId: existing.id, deletedAt: null } }),
            tx.samplePhoto.count({ where: { taskId: existing.id, deletedAt: null } }),
            tx.sampleDraftSection.findMany({ where: { taskId: existing.id }, select: { payload: true, revision: true, lastSubmittedRevision: true } }),
          ]);
          const hasDraftSectionData = sections.some(section => sampleDraftSectionHasData(section.payload));
          const hasUnsubmittedSectionData = sections.some(sampleDraftSectionHasUnsubmittedChange);
          if (existing.activeSubmissionId || blockingEntries + blockingPhotos > 0 || hasUnsubmittedSectionData) {
            throw new Error('SAMPLE_TASK_HAS_UNFINISHED_DATA');
          }
          if (totalEntries + totalPhotos === 0 && !hasDraftSectionData) {
            if (body.confirmNoData !== true) throw new Error('SAMPLE_TASK_CONFIRM_NO_DATA_REQUIRED');
            noDataCompletion = true;
          }
          status = 'COMPLETED';
          lifecycle.completedAt = now;
          lifecycle.archivedAt = now;
          lifecycle.archivedById = actor.id;
          lifecycle.archivedByName = actor.name;
          lifecycle.archiveReason = noDataCompletion ? '无采集数据完成后归档' : '任务完成后归档';
        }
      } else if (action === 'CANCEL') {
        if (status === 'CANCELLED' || status === 'COMPLETED') throw new Error('SAMPLE_TASK_CLOSED');
        const cancelReason = cleanSampleText(body.reason, 500) || '任务已取消';
        if (existing.activeSubmissionId) {
          await Promise.all([
            tx.sampleSubmission.updateMany({
              where: { id: existing.activeSubmissionId, taskId: existing.id, status: 'PENDING' },
              data: {
                status: 'CANCELLED',
                decision: 'CANCEL',
                decisionComment: cancelReason,
                decidedById: actor.id,
                decidedByName: actor.name,
                decidedAt: now,
              },
            }),
            tx.sampleDataEntry.updateMany({
              where: { taskId: existing.id, deletedAt: null, submissionRevision: existing.submissionRevision, reviewStatus: 'PENDING' },
              data: { reviewStatus: 'VOIDED', reviewComment: cancelReason, reviewedById: actor.id, reviewedByName: actor.name, reviewedAt: now, version: { increment: 1 } },
            }),
            tx.samplePhoto.updateMany({
              where: { taskId: existing.id, deletedAt: null, submissionRevision: existing.submissionRevision, reviewStatus: 'PENDING' },
              data: { reviewStatus: 'VOIDED', reviewComment: cancelReason, reviewedById: actor.id, reviewedByName: actor.name, reviewedAt: now, version: { increment: 1 } },
            }),
          ]);
        }
        status = 'CANCELLED';
        lifecycle.cancelledAt = now;
        lifecycle.activeSubmissionId = null;
        lifecycle.submittedAt = null;
      } else if (action === 'ARCHIVE') {
        if (status !== 'COMPLETED') throw new Error('SAMPLE_TASK_ARCHIVE_STATE_INVALID');
        lifecycle.archivedAt = existing.archivedAt || now;
        lifecycle.archivedById = actor.id;
        lifecycle.archivedByName = actor.name;
        lifecycle.archiveReason = cleanSampleText(body.reason, 500) || existing.archiveReason || '手动归档';
      } else if (action === 'UNARCHIVE') {
        if (status !== 'COMPLETED') throw new Error('SAMPLE_TASK_ARCHIVE_STATE_INVALID');
        lifecycle.archivedAt = null;
        lifecycle.archivedById = null;
        lifecycle.archivedByName = null;
        lifecycle.archiveReason = null;
      } else if (status === 'CANCELLED' || status === 'COMPLETED') {
        throw new Error('SAMPLE_TASK_CLOSED');
      }
      const metadataUpdate = action === 'UPDATE';
      const dueDate = !metadataUpdate || body.dueDate === undefined ? existing.dueDate : parseOptionalSampleDate(body.dueDate);
      const sampleQuantity = !metadataUpdate || body.sampleQuantity === undefined
        ? existing.sampleQuantity
        : parseOptionalNonNegativeInteger(body.sampleQuantity);
      const customerLevel = metadataUpdate
        ? sampleCustomerLevel(body.customerLevelCode === undefined ? existing.customerLevelCode : body.customerLevelCode)
        : null;
      if (metadataUpdate && !customerLevel) throw new Error('INVALID_SAMPLE_LEVEL');
      const updated = await tx.sampleTask.updateMany({
        where: { id: existing.id, version: expectedVersion },
        data: {
          status,
          ...lifecycle,
          sourceOrderNo: !metadataUpdate || body.sourceOrderNo === undefined ? existing.sourceOrderNo : cleanSampleText(body.sourceOrderNo, 120),
          customerLevelCode: metadataUpdate ? customerLevel!.code : existing.customerLevelCode,
          customerLevelLabel: metadataUpdate ? customerLevel!.label : existing.customerLevelLabel,
          customerLevelColor: metadataUpdate ? customerLevel!.color : existing.customerLevelColor,
          sampleQuantity,
          dueDate,
          priority: metadataUpdate ? customerLevel!.priority : existing.priority,
          planRemark: !metadataUpdate || body.planRemark === undefined ? existing.planRemark : cleanSampleText(body.planRemark, 1000),
          updatedById: actor.id,
          updatedByName: actor.name,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new Error('SAMPLE_TASK_CONFLICT');
      if (assigneeIds && action === 'UPDATE') {
        const employees = assigneeIds.length
          ? await tx.employee.findMany({
              where: { id: { in: assigneeIds }, isActive: true, resignedAt: null },
              select: { id: true },
            })
          : [];
        await tx.sampleTaskAssignee.deleteMany({ where: { taskId: existing.id } });
        if (employees.length) {
          await tx.sampleTaskAssignee.createMany({
            data: employees.map(employee => ({
              taskId: existing.id,
              employeeId: employee.id,
              assignedById: actor.id,
              assignedByName: actor.name,
            })),
          });
        }
      }
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: action === 'UPDATE' ? 'update_sample_task' : `sample_task_${action.toLowerCase()}`,
          targetType: 'sample_task',
          targetId: existing.id,
          detail: { fromStatus: existing.status, toStatus: status, expectedVersion, noDataCompletion },
        },
      });
      return existing.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const task = await prisma.sampleTask.findUnique({ where: { id: resultId }, include: sampleTaskInclude });
    return NextResponse.json({ ok: true, task: task ? serializeSampleTask(task) : null });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error) {
      if (error.message === 'SAMPLE_TASK_NOT_FOUND') return NextResponse.json({ ok: false, error: '样品任务不存在' }, { status: 404 });
      if (error.message === 'SAMPLE_TASK_CONFLICT') return NextResponse.json({ ok: false, error: '样品任务已被其他人修改，请刷新后重试' }, { status: 409 });
      if (error.message === 'SAMPLE_TASK_CLOSED') return NextResponse.json({ ok: false, error: '已完成或已取消任务仅支持查看历史，不能重新打开或修改' }, { status: 409 });
      if (error.message === 'SAMPLE_TASK_SUBMITTED') return NextResponse.json({ ok: false, error: '任务已经提交整包审核，不能再次开始' }, { status: 409 });
      if (error.message === 'SAMPLE_TASK_ARCHIVE_STATE_INVALID') return NextResponse.json({ ok: false, error: '只有已完成任务可以归档或取消归档' }, { status: 409 });
      if (error.message === 'SAMPLE_TASK_HAS_UNFINISHED_DATA') return NextResponse.json({ ok: false, error: '任务仍有草稿、待审核或退回修改内容，处理完成后才能结束任务' }, { status: 409 });
      if (error.message === 'SAMPLE_TASK_CONFIRM_NO_DATA_REQUIRED') return NextResponse.json({ ok: false, error: '任务没有任何采集记录，请明确确认“无采集数据完成”' }, { status: 409 });
      if (error.message === 'INVALID_SAMPLE_DATE') return NextResponse.json({ ok: false, error: '计划完成日期格式无效' }, { status: 400 });
      if (error.message === 'INVALID_SAMPLE_LEVEL') return NextResponse.json({ ok: false, error: '客户等级只能选择 A、B、C、D' }, { status: 400 });
      if (error.message === 'INVALID_SAMPLE_NUMBER') return NextResponse.json({ ok: false, error: '数量或优先级格式无效' }, { status: 400 });
    }
    console.error('sample task update failed', error);
    return NextResponse.json({ ok: false, error: '样品任务保存失败' }, { status: 500 });
  }
}
