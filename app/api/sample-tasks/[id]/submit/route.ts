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
  serializeSampleSubmission,
  serializeSampleTask,
} from '@/lib/sample-team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DraftRow = Record<string, unknown>;

function rowsOf(payload: Prisma.JsonValue): DraftRow[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const rows = (payload as Record<string, unknown>).rows;
  return Array.isArray(rows)
    ? rows.filter((row): row is DraftRow => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
    : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function processRowPayload(row: DraftRow, sectionRevision: number): Prisma.InputJsonObject | null {
  const processDefinitionId = cleanSampleText(row.processDefinitionId, 80);
  const processName = cleanSampleText(row.processName, 120);
  const measuredMilliseconds = row.measuredMilliseconds === null || row.measuredMilliseconds === undefined || row.measuredMilliseconds === ''
    ? null
    : Number(row.measuredMilliseconds);
  if (!processDefinitionId && !processName && measuredMilliseconds === null) return null;
  if (!processName || !Number.isInteger(measuredMilliseconds) || measuredMilliseconds! <= 0) {
    throw new Error('SAMPLE_PROCESS_ROW_INCOMPLETE');
  }
  const processOrigin = row.processOrigin === 'MASTER' ? 'MASTER' : 'PROPOSED';
  if ((processOrigin === 'MASTER') !== Boolean(processDefinitionId)) throw new Error('SAMPLE_PROCESS_ROW_INCOMPLETE');
  return {
    rowId: text(row.rowId),
    sectionRevision,
    position: Number(row.position),
    processDefinitionId,
    processName,
    processOrigin,
    measuredMilliseconds,
    recommendedSeconds: measuredMilliseconds! / 1000,
    timeBasis: 'per_unit',
    unitLabel: '件',
  };
}

function strippingRowPayload(row: DraftRow, sectionRevision: number): Prisma.InputJsonObject | null {
  const model = cleanSampleText(row.model, 160);
  const outerPeelMm = cleanSampleText(row.outerPeelMm, 30);
  const innerPeelMm = cleanSampleText(row.innerPeelMm, 30);
  const insertionLengthMm = cleanSampleText(row.insertionLengthMm, 30);
  if (!model && !outerPeelMm && !innerPeelMm && !insertionLengthMm) return null;
  if (!model || (!outerPeelMm && !innerPeelMm && !insertionLengthMm)) throw new Error('SAMPLE_STRIPPING_ROW_INCOMPLETE');
  return {
    rowId: text(row.rowId),
    sectionRevision,
    position: Number(row.position),
    model,
    outerPeelMm,
    innerPeelMm,
    insertionLengthMm,
  };
}

async function materializeSectionRows(
  tx: Prisma.TransactionClient,
  taskId: string,
  kind: 'PROCESS_TIME' | 'STRIPPING',
  sectionRevision: number,
  rows: DraftRow[],
  submissionRevision: number,
  actor: { id: string; name: string },
) {
  const activeRowIds: string[] = [];
  for (const row of rows) {
    const rowId = text(row.rowId);
    const payload = kind === 'PROCESS_TIME'
      ? processRowPayload(row, sectionRevision)
      : strippingRowPayload(row, sectionRevision);
    if (!payload) continue;
    activeRowIds.push(rowId);
    const label = kind === 'PROCESS_TIME'
      ? cleanSampleText(payload.processName, 200)
      : cleanSampleText(payload.model, 200);
    const existing = await tx.sampleDataEntry.findFirst({
      where: {
        taskId,
        deletedAt: null,
        reviewStatus: { in: ['DRAFT', 'CHANGES_REQUESTED'] },
        OR: [
          { draftSectionKind: kind, draftRowId: rowId },
          // Pre-P0 mobile records are restored into a section with the entry
          // id as rowId. Adopt that row in place instead of creating a second
          // review item for the same captured fact.
          { id: rowId, kind, draftSectionKind: null, draftRowId: null },
        ],
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (existing) {
      await tx.sampleDataEntry.update({
        where: { id: existing.id },
        data: {
          kind,
          label,
          payload,
          draftSectionKind: kind,
          draftRowId: rowId,
          submissionRevision,
          reviewStatus: 'DRAFT',
          publishMode: null,
          reviewComment: null,
          reviewedById: null,
          reviewedByName: null,
          reviewedAt: null,
          updatedById: actor.id,
          updatedByName: actor.name,
          version: { increment: 1 },
        },
      });
    } else {
      await tx.sampleDataEntry.create({
        data: {
          taskId,
          kind,
          label,
          payload,
          clientMutationId: `section:${kind}:${rowId}:r${submissionRevision}`,
          draftSectionKind: kind,
          draftRowId: rowId,
          submissionRevision,
          createdById: actor.id,
          createdByName: actor.name,
          updatedById: actor.id,
          updatedByName: actor.name,
        },
      });
    }
  }
  await tx.sampleDataEntry.updateMany({
    where: {
      taskId,
      draftSectionKind: kind,
      deletedAt: null,
      reviewStatus: { in: ['DRAFT', 'CHANGES_REQUESTED'] },
      ...(activeRowIds.length ? { draftRowId: { notIn: activeRowIds } } : {}),
    },
    data: {
      deletedAt: new Date(),
      updatedById: actor.id,
      updatedByName: actor.name,
      version: { increment: 1 },
    },
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const actor = sampleActor(user);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const expectedVersion = Number(body.expectedVersion);
    const clientMutationId = cleanSampleText(body.clientMutationId, 80);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return NextResponse.json({ ok: false, error: '样品任务版本已失效，请刷新后重试' }, { status: 400 });
    }
    if (!clientMutationId) return NextResponse.json({ ok: false, error: '缺少提交编号，请重新提交' }, { status: 400 });
    const requestHash = sampleRequestHash({ expectedVersion, clientMutationId });

    const submissionId = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-task:${params.id}`}))`;
      const task = await tx.sampleTask.findFirst({ where: { id: params.id, deletedAt: null } });
      if (!task) throw new Error('SAMPLE_TASK_NOT_FOUND');
      if (task.status === 'CANCELLED' || task.status === 'COMPLETED') throw new Error('SAMPLE_TASK_CLOSED');
      const replay = await tx.sampleSubmission.findUnique({
        where: { taskId_mutationId: { taskId: task.id, mutationId: clientMutationId } },
      });
      if (replay) {
        if (replay.requestHash !== requestHash) throw new Error('SAMPLE_MUTATION_CONFLICT');
        return replay.id;
      }
      if (task.version !== expectedVersion) throw new Error('SAMPLE_TASK_CONFLICT');
      if (task.status === 'SUBMITTED' || task.activeSubmissionId) throw new Error('SAMPLE_TASK_ALREADY_SUBMITTED');
      const existingPending = await tx.sampleDataEntry.count({ where: { taskId: task.id, deletedAt: null, reviewStatus: 'PENDING' } })
        + await tx.samplePhoto.count({ where: { taskId: task.id, deletedAt: null, reviewStatus: 'PENDING' } });
      if (existingPending) throw new Error('SAMPLE_PENDING_WITHOUT_SUBMISSION');

      const nextRevision = task.submissionRevision + 1;
      const sections = await tx.sampleDraftSection.findMany({ where: { taskId: task.id }, orderBy: { kind: 'asc' } });
      for (const section of sections) {
        if (section.kind !== 'PROCESS_TIME' && section.kind !== 'STRIPPING') continue;
        const rows = rowsOf(section.payload);
        if (section.kind === 'PROCESS_TIME') {
          const processIds = [...new Set(rows.map(row => cleanSampleText(row.processDefinitionId, 80)).filter((id): id is string => Boolean(id)))];
          if (processIds.length) {
            const count = await tx.processDefinition.count({ where: { id: { in: processIds }, isActive: true } });
            if (count !== processIds.length) throw new Error('SAMPLE_PROCESS_NOT_FOUND');
          }
        }
        await materializeSectionRows(tx, task.id, section.kind, section.revision, rows, nextRevision, actor);
        await tx.sampleDraftSection.update({
          where: { id: section.id },
          data: { lastSubmittedRevision: section.revision },
        });
      }

      const [draftEntries, draftPhotos] = await Promise.all([
        tx.sampleDataEntry.findMany({
          where: { taskId: task.id, deletedAt: null, reviewStatus: { in: ['DRAFT', 'CHANGES_REQUESTED'] } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
        tx.samplePhoto.findMany({
          where: { taskId: task.id, deletedAt: null, reviewStatus: { in: ['DRAFT', 'CHANGES_REQUESTED'] } },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        }),
      ]);
      if (draftEntries.length + draftPhotos.length === 0) throw new Error('SAMPLE_EMPTY_SUBMISSION');

      const contentHash = sampleRequestHash({
        taskId: task.id,
        drawingLibraryItemId: task.drawingLibraryItemId,
        sections: sections.map(section => ({ kind: section.kind, payload: section.payload })),
        entries: draftEntries.map(entry => ({ kind: entry.kind, label: entry.label, payload: entry.payload })),
        photos: draftPhotos.map(photo => ({
          sha256: photo.sha256,
          category: photo.category,
          caption: photo.caption,
          linkedEntryId: photo.linkedEntryId,
          sortOrder: photo.sortOrder,
        })),
      });
      const unchangedSubmission = await tx.sampleSubmission.findFirst({
        where: { taskId: task.id, contentHash, status: { in: ['REJECTED', 'CONFIRMED', 'REVIEWED'] } },
        orderBy: [{ revision: 'desc' }, { submittedAt: 'desc' }],
        select: { id: true },
      });
      if (unchangedSubmission) throw new Error('SAMPLE_SUBMISSION_UNCHANGED');

      const now = new Date();
      const snapshot = JSON.parse(JSON.stringify({
        schemaVersion: 2,
        task: {
          id: task.id,
          code: task.code,
          taskVersion: task.version,
          submissionRevision: nextRevision,
          customerName: task.customerNameSnapshot,
          productName: task.productNameSnapshot,
          specification: task.specificationSnapshot,
        },
        sections: sections.map(section => ({
          id: section.id,
          kind: section.kind,
          revision: section.revision,
          schemaVersion: section.schemaVersion,
          payload: section.payload,
          uiState: section.uiState,
        })),
        entries: draftEntries.map(entry => ({
          id: entry.id,
          kind: entry.kind,
          label: entry.label,
          payload: entry.payload,
          version: entry.version,
        })),
        photos: draftPhotos.map(photo => ({
          id: photo.id,
          category: photo.category,
          caption: photo.caption,
          originalName: photo.originalName,
          mimeType: photo.mimeType,
          size: photo.size,
          sha256: photo.sha256,
          sortOrder: photo.sortOrder,
          version: photo.version,
        })),
        submittedAt: now.toISOString(),
      })) as Prisma.InputJsonObject;
      const submission = await tx.sampleSubmission.create({
        data: {
          taskId: task.id,
          revision: nextRevision,
          mutationId: clientMutationId,
          requestHash,
          contentHash,
          status: 'PENDING',
          snapshot,
          submittedById: actor.id,
          submittedByName: actor.name,
          submittedAt: now,
        },
        select: { id: true },
      });
      const [entries, photos] = await Promise.all([
        tx.sampleDataEntry.updateMany({
          where: { id: { in: draftEntries.map(entry => entry.id) } },
          data: { reviewStatus: 'PENDING', reviewComment: null, submissionRevision: nextRevision, version: { increment: 1 } },
        }),
        tx.samplePhoto.updateMany({
          where: { id: { in: draftPhotos.map(photo => photo.id) } },
          data: { reviewStatus: 'PENDING', reviewComment: null, submissionRevision: nextRevision, version: { increment: 1 } },
        }),
      ]);
      const updated = await tx.sampleTask.updateMany({
        where: { id: task.id, version: expectedVersion },
        data: {
          status: 'SUBMITTED',
          submittedAt: now,
          submissionRevision: nextRevision,
          activeSubmissionId: submission.id,
          updatedById: actor.id,
          updatedByName: actor.name,
          lastSubmissionMutationId: clientMutationId,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new Error('SAMPLE_TASK_CONFLICT');
      await refreshSampleTaskDataStatus(tx, task.id);
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'submit_sample_task_data',
          targetType: 'sample_submission',
          targetId: submission.id,
          detail: {
            taskId: task.id,
            taskCode: task.code,
            submissionRevision: nextRevision,
            submittedEntries: entries.count,
            submittedPhotos: photos.count,
            clientMutationId,
            requestHash,
          },
        },
      });
      return submission.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const [task, submission] = await Promise.all([
      prisma.sampleTask.findUnique({ where: { id: params.id }, include: sampleTaskInclude }),
      prisma.sampleSubmission.findUnique({ where: { id: submissionId } }),
    ]);
    return NextResponse.json({
      ok: true,
      task: task ? serializeSampleTask(task) : null,
      submission: submission ? serializeSampleSubmission(submission) : null,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error) {
      if (error.message === 'SAMPLE_TASK_NOT_FOUND') return NextResponse.json({ ok: false, error: '样品任务不存在' }, { status: 404 });
      if (error.message === 'SAMPLE_TASK_CONFLICT') return NextResponse.json({ ok: false, error: '样品任务已被其他人修改，请刷新后重试' }, { status: 409 });
      if (error.message === 'SAMPLE_TASK_CLOSED') return NextResponse.json({ ok: false, error: '已完成或已取消任务不能提交审核' }, { status: 409 });
      if (error.message === 'SAMPLE_TASK_ALREADY_SUBMITTED') return NextResponse.json({ ok: false, error: '样品数据已经提交，请勿重复提交' }, { status: 409 });
      if (error.message === 'SAMPLE_EMPTY_SUBMISSION') return NextResponse.json({ ok: false, error: '没有可提交的草稿数据或照片' }, { status: 400 });
      if (error.message === 'SAMPLE_PROCESS_ROW_INCOMPLETE') return NextResponse.json({ ok: false, error: '工序与实测工时必须成对填写' }, { status: 400 });
      if (error.message === 'SAMPLE_STRIPPING_ROW_INCOMPLETE') return NextResponse.json({ ok: false, error: '剥皮参数必须填写型号和至少一个尺寸' }, { status: 400 });
      if (error.message === 'SAMPLE_PROCESS_NOT_FOUND') return NextResponse.json({ ok: false, error: '所选正式工序已停用或不存在，请重新选择' }, { status: 409 });
      if (error.message === 'SAMPLE_PENDING_WITHOUT_SUBMISSION') return NextResponse.json({ ok: false, error: '任务存在未归属提交版本的待审核数据，请联系管理员处理' }, { status: 409 });
      if (error.message === 'SAMPLE_SUBMISSION_UNCHANGED') return NextResponse.json({ ok: false, error: '资料内容与上一次提交完全相同，请先完成实际修改，不能重复提交相同数据' }, { status: 409 });
      if (error.message === 'SAMPLE_MUTATION_CONFLICT') return NextResponse.json({ ok: false, error: '同一提交编号对应了不同请求，请刷新后重试' }, { status: 409 });
    }
    console.error('submit sample task failed', error);
    return NextResponse.json({ ok: false, error: '样品任务提交失败' }, { status: 500 });
  }
}
