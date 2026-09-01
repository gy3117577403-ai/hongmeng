import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  cleanSampleColor,
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
    const assigneeIds = ids(body.assigneeEmployeeIds);
    const now = new Date();
    const resultId = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-task:${params.id}`}))`;
      const existing = await tx.sampleTask.findFirst({ where: { id: params.id, deletedAt: null } });
      if (!existing) throw new Error('SAMPLE_TASK_NOT_FOUND');
      if (existing.version !== expectedVersion) throw new Error('SAMPLE_TASK_CONFLICT');
      let status = existing.status;
      const lifecycle: Prisma.SampleTaskUpdateInput = {};
      let noDataCompletion = false;
      if (action === 'START') {
        if (status !== 'CANCELLED' && status !== 'COMPLETED') {
          status = 'IN_PROGRESS';
          lifecycle.startedAt = existing.startedAt || now;
        }
      } else if (action === 'COMPLETE') {
        if (status !== 'CANCELLED') {
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
        }
      } else if (action === 'CANCEL') {
        const pendingReviewCount = await tx.sampleDataEntry.count({ where: { taskId: existing.id, deletedAt: null, reviewStatus: 'PENDING' } })
          + await tx.samplePhoto.count({ where: { taskId: existing.id, deletedAt: null, reviewStatus: 'PENDING' } });
        if (existing.status === 'SUBMITTED' || existing.activeSubmissionId || pendingReviewCount > 0) {
          throw new Error('SAMPLE_TASK_SUBMITTED_CANCEL_BLOCKED');
        }
        status = 'CANCELLED';
        lifecycle.cancelledAt = now;
      } else if (action === 'REOPEN') {
        status = 'IN_PROGRESS';
        lifecycle.cancelledAt = null;
        lifecycle.completedAt = null;
        lifecycle.startedAt = existing.startedAt || now;
      }
      const dueDate = body.dueDate === undefined ? existing.dueDate : parseOptionalSampleDate(body.dueDate);
      const sampleQuantity = body.sampleQuantity === undefined
        ? existing.sampleQuantity
        : parseOptionalNonNegativeInteger(body.sampleQuantity);
      const priority = body.priority === undefined
        ? existing.priority
        : (parseOptionalNonNegativeInteger(body.priority, 9) ?? 0);
      const updated = await tx.sampleTask.updateMany({
        where: { id: existing.id, version: expectedVersion },
        data: {
          status,
          ...lifecycle,
          sourceOrderNo: body.sourceOrderNo === undefined ? existing.sourceOrderNo : cleanSampleText(body.sourceOrderNo, 120),
          customerLevelCode: body.customerLevelCode === undefined ? existing.customerLevelCode : cleanSampleText(body.customerLevelCode, 30),
          customerLevelLabel: body.customerLevelLabel === undefined ? existing.customerLevelLabel : cleanSampleText(body.customerLevelLabel, 60),
          customerLevelColor: body.customerLevelColor === undefined ? existing.customerLevelColor : cleanSampleColor(body.customerLevelColor),
          sampleQuantity,
          dueDate,
          priority,
          planRemark: body.planRemark === undefined ? existing.planRemark : cleanSampleText(body.planRemark, 1000),
          updatedById: actor.id,
          updatedByName: actor.name,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new Error('SAMPLE_TASK_CONFLICT');
      if (assigneeIds) {
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
      if (error.message === 'SAMPLE_TASK_HAS_UNFINISHED_DATA') return NextResponse.json({ ok: false, error: '任务仍有草稿、待审核或退回修改内容，处理完成后才能结束任务' }, { status: 409 });
      if (error.message === 'SAMPLE_TASK_CONFIRM_NO_DATA_REQUIRED') return NextResponse.json({ ok: false, error: '任务没有任何采集记录，请明确确认“无采集数据完成”' }, { status: 409 });
      if (error.message === 'SAMPLE_TASK_SUBMITTED_CANCEL_BLOCKED') return NextResponse.json({ ok: false, error: '任务正在审核中，请先撤回提交或由审核人员退回后再取消' }, { status: 409 });
      if (error.message === 'INVALID_SAMPLE_DATE') return NextResponse.json({ ok: false, error: '计划完成日期格式无效' }, { status: 400 });
      if (error.message === 'INVALID_SAMPLE_NUMBER') return NextResponse.json({ ok: false, error: '数量或优先级格式无效' }, { status: 400 });
    }
    console.error('sample task update failed', error);
    return NextResponse.json({ ok: false, error: '样品任务保存失败' }, { status: 500 });
  }
}
