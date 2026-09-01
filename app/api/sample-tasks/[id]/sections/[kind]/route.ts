import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  cleanSampleText,
  isSampleDraftSectionKind,
  refreshSampleTaskDataStatus,
  sampleActor,
  sampleDraftSectionHasData,
  sampleRequestHash,
  sampleTaskInclude,
  sanitizeSampleDraftSection,
  sanitizeSampleDraftUiState,
  serializeSampleDraftSection,
  serializeSampleTask,
} from '@/lib/sample-team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function responseFor(error: Error) {
  if (error.message === 'SAMPLE_TASK_NOT_FOUND') return NextResponse.json({ ok: false, error: '样品任务不存在' }, { status: 404 });
  if (error.message === 'SAMPLE_TASK_CLOSED') return NextResponse.json({ ok: false, error: '已完成或已取消任务不能保存草稿，请先重新打开任务' }, { status: 409 });
  if (error.message === 'SAMPLE_TASK_SUBMITTED') return NextResponse.json({ ok: false, error: '样品数据已经提交，请先撤回提交再编辑' }, { status: 409 });
  if (error.message === 'SAMPLE_TASK_CONFLICT') return NextResponse.json({ ok: false, error: '样品任务已被其他人修改，请刷新后重试' }, { status: 409 });
  if (error.message === 'SAMPLE_SECTION_CONFLICT') return NextResponse.json({ ok: false, error: '该分区草稿已被其他人修改，请刷新后重试' }, { status: 409 });
  if (error.message === 'SAMPLE_MUTATION_CONFLICT') return NextResponse.json({ ok: false, error: '同一保存编号对应了不同内容，请重新保存' }, { status: 409 });
  if (error.message === 'SAMPLE_PROCESS_NOT_FOUND') return NextResponse.json({ ok: false, error: '所选正式工序已停用或不存在，请重新选择' }, { status: 409 });
  if (error.message === 'SAMPLE_SECTION_CLEAR_REQUIRES_VOID') return NextResponse.json({ ok: false, error: '该分区已有通过或发布记录，不能直接清空，请由审核人员作废后再修订' }, { status: 409 });
  if (error.message === 'SAMPLE_DRAFT_ROW_LIMIT') return NextResponse.json({ ok: false, error: '每个分区最多保存50行' }, { status: 400 });
  if (['INVALID_SAMPLE_DRAFT_SECTION', 'INVALID_SAMPLE_DRAFT_ROW', 'DUPLICATE_SAMPLE_DRAFT_ROW', 'INVALID_SAMPLE_PROCESS_TIME', 'INVALID_SAMPLE_PROCESS_REFERENCE', 'INVALID_SAMPLE_STRIPPING_VALUE', 'INVALID_SAMPLE_DRAFT_UI_STATE', 'SAMPLE_DRAFT_UI_STATE_TOO_LARGE'].includes(error.message)) {
    return NextResponse.json({ ok: false, error: '草稿字段格式无效，请检查行号、工序、工时或剥皮参数' }, { status: 400 });
  }
  return null;
}

export async function PUT(req: NextRequest, { params }: { params: { id: string; kind: string } }) {
  try {
    const user = await requireUser();
    const actor = sampleActor(user);
    if (!isSampleDraftSectionKind(params.kind)) {
      return NextResponse.json({ ok: false, error: '只支持工序工时或剥皮参数分区' }, { status: 400 });
    }
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const expectedTaskVersion = Number(body.expectedTaskVersion);
    const expectedSectionRevision = Number(body.expectedSectionRevision);
    const clientMutationId = cleanSampleText(body.clientMutationId, 80);
    if (!Number.isInteger(expectedTaskVersion) || expectedTaskVersion < 1) {
      return NextResponse.json({ ok: false, error: '样品任务版本已失效，请刷新后重试' }, { status: 400 });
    }
    if (!Number.isInteger(expectedSectionRevision) || expectedSectionRevision < 0) {
      return NextResponse.json({ ok: false, error: '分区草稿版本无效，请刷新后重试' }, { status: 400 });
    }
    if (!clientMutationId) return NextResponse.json({ ok: false, error: '缺少保存编号，请重新保存' }, { status: 400 });

    const payload = sanitizeSampleDraftSection(params.kind, body.payload);
    const uiState = sanitizeSampleDraftUiState(body.uiState);
    const requestHash = sampleRequestHash({ kind: params.kind, payload, uiState });
    const lastEditedRowId = cleanSampleText((uiState as Record<string, unknown>).lastEditedRowId, 80);

    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-task:${params.id}`}))`;
      const task = await tx.sampleTask.findFirst({ where: { id: params.id, deletedAt: null } });
      if (!task) throw new Error('SAMPLE_TASK_NOT_FOUND');
      const existing = await tx.sampleDraftSection.findUnique({
        where: { taskId_kind: { taskId: task.id, kind: params.kind } },
      });
      if (existing?.lastMutationId === clientMutationId) {
        if (existing.lastRequestHash !== requestHash) throw new Error('SAMPLE_MUTATION_CONFLICT');
        return { taskId: task.id, sectionId: existing.id };
      }
      if (task.version !== expectedTaskVersion) throw new Error('SAMPLE_TASK_CONFLICT');
      if (task.status === 'CANCELLED' || task.status === 'COMPLETED') throw new Error('SAMPLE_TASK_CLOSED');
      if (task.status === 'SUBMITTED' || task.activeSubmissionId) throw new Error('SAMPLE_TASK_SUBMITTED');
      if ((existing?.revision || 0) !== expectedSectionRevision) throw new Error('SAMPLE_SECTION_CONFLICT');

      const clearsSubmittedSection = Boolean(existing && existing.lastSubmittedRevision > 0 && !sampleDraftSectionHasData(payload));
      if (clearsSubmittedSection) {
        const reviewed = await tx.sampleDataEntry.count({
          where: {
            taskId: task.id,
            draftSectionKind: params.kind,
            deletedAt: null,
            reviewStatus: { in: ['APPROVED', 'PUBLISHED'] },
          },
        });
        if (reviewed) throw new Error('SAMPLE_SECTION_CLEAR_REQUIRES_VOID');
        await tx.sampleDataEntry.updateMany({
          where: {
            taskId: task.id,
            draftSectionKind: params.kind,
            deletedAt: null,
            reviewStatus: { in: ['DRAFT', 'CHANGES_REQUESTED'] },
          },
          data: {
            deletedAt: new Date(),
            updatedById: actor.id,
            updatedByName: actor.name,
            version: { increment: 1 },
          },
        });
      }

      if (params.kind === 'PROCESS_TIME') {
        const rows = (payload.rows || []) as Array<Record<string, unknown>>;
        const processIds = [...new Set(rows.map(row => cleanSampleText(row.processDefinitionId, 80)).filter((id): id is string => Boolean(id)))];
        if (processIds.length) {
          const count = await tx.processDefinition.count({ where: { id: { in: processIds }, isActive: true } });
          if (count !== processIds.length) throw new Error('SAMPLE_PROCESS_NOT_FOUND');
        }
      }

      let sectionId: string;
      if (existing) {
        const updated = await tx.sampleDraftSection.updateMany({
          where: { id: existing.id, revision: expectedSectionRevision },
          data: {
            schemaVersion: 1,
            payload,
            uiState,
            lastMutationId: clientMutationId,
            lastRequestHash: requestHash,
            ...(clearsSubmittedSection ? { lastSubmittedRevision: expectedSectionRevision + 1 } : {}),
            updatedById: actor.id,
            updatedByName: actor.name,
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new Error('SAMPLE_SECTION_CONFLICT');
        sectionId = existing.id;
      } else {
        const section = await tx.sampleDraftSection.create({
          data: {
            taskId: task.id,
            kind: params.kind,
            schemaVersion: 1,
            revision: 1,
            payload,
            uiState,
            lastMutationId: clientMutationId,
            lastRequestHash: requestHash,
            updatedById: actor.id,
            updatedByName: actor.name,
          },
          select: { id: true },
        });
        sectionId = section.id;
      }
      const updatedTask = await tx.sampleTask.updateMany({
        where: { id: task.id, version: expectedTaskVersion },
        data: {
          status: 'IN_PROGRESS',
          startedAt: task.startedAt || new Date(),
          submittedAt: null,
          lastEditedKind: params.kind,
          lastEditedRowId,
          updatedById: actor.id,
          updatedByName: actor.name,
          version: { increment: 1 },
        },
      });
      if (updatedTask.count !== 1) throw new Error('SAMPLE_TASK_CONFLICT');
      await refreshSampleTaskDataStatus(tx, task.id);
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'save_sample_draft_section',
          targetType: 'sample_draft_section',
          targetId: sectionId,
          detail: {
            taskId: task.id,
            taskCode: task.code,
            kind: params.kind,
            fromRevision: expectedSectionRevision,
            toRevision: expectedSectionRevision + 1,
            clientMutationId,
            requestHash,
            clearsSubmittedSection,
          },
        },
      });
      return { taskId: task.id, sectionId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const [task, section] = await Promise.all([
      prisma.sampleTask.findUnique({ where: { id: result.taskId }, include: sampleTaskInclude }),
      prisma.sampleDraftSection.findUnique({ where: { id: result.sectionId } }),
    ]);
    return NextResponse.json({
      ok: true,
      task: task ? serializeSampleTask(task) : null,
      section: section ? serializeSampleDraftSection(section) : null,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error) {
      const response = responseFor(error);
      if (response) return response;
    }
    console.error('save sample draft section failed', error);
    return NextResponse.json({ ok: false, error: '样品采集草稿保存失败' }, { status: 500 });
  }
}
