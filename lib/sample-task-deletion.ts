import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { cleanSampleText, sampleRequestHash, sampleTaskInclude, serializeSampleTask } from '@/lib/sample-team';

export type SampleTaskDeleteMode = 'REMOVE_TASK_ONLY' | 'RETIRE_TEST_OUTPUTS';

export class SampleTaskDeletionError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'SampleTaskDeletionError';
  }
}

function stableHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function loadDeleteState(db: Prisma.TransactionClient, id: string, includeDeleted = false) {
  const task = await db.sampleTask.findFirst({
    where: { id, ...(includeDeleted ? {} : { deletedAt: null }) },
    include: sampleTaskInclude,
  });
  if (!task) throw new SampleTaskDeletionError('样品任务不存在或已经删除', 404);

  const entryIds = task.entries.map(item => item.id).sort();
  const photoIds = task.photos.map(item => item.id).sort();
  const directPublishedFileIds = task.photos.flatMap(item => item.publishedFileId ? [item.publishedFileId] : []).sort();
  const [submissionCount, assigneeCount, draftSectionCount, directProductDataRecordCount, bindingsFromEntries, publicationLinks] = await Promise.all([
    db.sampleSubmission.count({ where: { taskId: task.id } }),
    db.sampleTaskAssignee.count({ where: { taskId: task.id } }),
    db.sampleDraftSection.count({ where: { taskId: task.id } }),
    entryIds.length ? db.productDataRecord.count({ where: { sourceSampleEntryId: { in: entryIds } } }) : Promise.resolve(0),
    entryIds.length ? db.productConnectorParameterBinding.findMany({
      where: { sourceSampleEntryId: { in: entryIds } },
      select: { id: true, connectorParameterId: true, isCurrent: true, status: true },
      orderBy: { id: 'asc' },
    }) : Promise.resolve([]),
    db.samplePublicationLink.findMany({
      where: { sampleTaskId: task.id },
      select: { id: true, targetType: true, targetId: true, targetChildId: true, publicationStatus: true, updatedAt: true },
      orderBy: { id: 'asc' },
    }),
  ]);

  const linkedBindingIds = publicationLinks.filter(item => item.targetType === 'connector_parameter_binding').map(item => item.targetId);
  const bindings = linkedBindingIds.length
    ? await db.productConnectorParameterBinding.findMany({
        where: {
          OR: [
            ...(entryIds.length ? [{ sourceSampleEntryId: { in: entryIds } }] : []),
            { id: { in: linkedBindingIds } },
          ],
        },
        select: { id: true, connectorParameterId: true, isCurrent: true, status: true },
        orderBy: { id: 'asc' },
      })
    : bindingsFromEntries;
  const publishedFileIds = [...new Set([
    ...directPublishedFileIds,
    ...publicationLinks.filter(item => item.targetType === 'drawing_library_file').map(item => item.targetId),
  ])].sort();
  const productDataRecordIds = publicationLinks.filter(item => item.targetType === 'product_data_record').map(item => item.targetId);
  const productDataRecordCount = productDataRecordIds.length
    ? await db.productDataRecord.count({ where: { OR: [{ id: { in: productDataRecordIds } }, ...(entryIds.length ? [{ sourceSampleEntryId: { in: entryIds } }] : [])] } })
    : directProductDataRecordCount;

  const connectorParameterIds = [...new Set(bindings.map(item => item.connectorParameterId))].sort();
  const [sharedBindingCount, assemblyManualBindingCount] = connectorParameterIds.length ? await Promise.all([
    db.productConnectorParameterBinding.count({
      where: {
        connectorParameterId: { in: connectorParameterIds },
        sourceSampleEntryId: entryIds.length ? { notIn: entryIds } : undefined,
        isCurrent: true,
      },
    }),
    db.connectorAssemblyManualBinding.count({ where: { connectorParameterId: { in: connectorParameterIds } } }),
  ]) : [0, 0];

  const timeProfileIds = task.entries
    .filter(item => item.publishedEntityType === 'product_time_profile' && item.publishedEntityId)
    .map(item => item.publishedEntityId as string);
  const processDefinitionIds = task.entries
    .filter(item => item.publishedEntityType === 'process_definition' && item.publishedEntityId)
    .map(item => item.publishedEntityId as string);

  const impact = {
    assigneeCount,
    draftSectionCount,
    submissionCount,
    entryCount: task.entries.length,
    photoCount: task.photos.length,
    publishedDrawingFileCount: publishedFileIds.length,
    productDataRecordCount,
    connectorBindingCount: bindings.length,
    connectorParameterCount: connectorParameterIds.length,
    sharedConnectorBindingCount: sharedBindingCount,
    assemblyManualBindingCount,
    affectedProductTimeProfileCount: new Set(timeProfileIds).size,
    autoCreatedProcessCount: new Set(processDefinitionIds).size,
    publicationLinkCount: publicationLinks.length,
    objectDeletionCount: 0,
  };

  const retirementBlockers: string[] = [];
  if (task.dataPurpose !== 'TEST') retirementBlockers.push('任务未标记为测试数据，禁止自动退役正式下游资料');
  if (impact.affectedProductTimeProfileCount) retirementBlockers.push('存在工时草稿发布，旧数据缺少可证明的行级来源，必须人工复核');
  if (impact.autoCreatedProcessCount) retirementBlockers.push('存在自动创建工序，必须核对其他路线和生产引用');
  if (impact.sharedConnectorBindingCount) retirementBlockers.push('连接器参数被其他产品当前绑定复用，只能移除本任务来源');
  if (impact.assemblyManualBindingCount) retirementBlockers.push('连接器参数已关联说明书，只能移除本任务来源');

  const tokenState = {
    task: {
      id: task.id,
      code: task.code,
      status: task.status,
      version: task.version,
      dataPurpose: task.dataPurpose,
      updatedAt: task.updatedAt.toISOString(),
      deletedAt: task.deletedAt?.toISOString() || null,
    },
    entryIds,
    photoIds,
    publishedFileIds,
    bindings,
    publicationLinks: publicationLinks.map(item => ({ ...item, updatedAt: item.updatedAt.toISOString() })),
    impact,
  };

  return {
    task,
    entryIds,
    photoIds,
    publishedFileIds,
    connectorParameterIds,
    bindings,
    publicationLinks,
    preview: {
      task: {
        id: task.id,
        code: task.code,
        customerName: task.customerNameSnapshot,
        productName: task.productNameSnapshot,
        specification: task.specificationSnapshot,
        status: task.status,
        version: task.version,
        dataPurpose: task.dataPurpose,
        completedAt: task.completedAt?.toISOString() || null,
        archivedAt: task.archivedAt?.toISOString() || null,
      },
      impact,
      blockers: task.status === 'COMPLETED' ? [] : ['只有已完成样品任务可以删除'],
      retirementBlockers,
      canDelete: task.status === 'COMPLETED' && !task.deletedAt,
      canRetireTestOutputs: task.status === 'COMPLETED' && !task.deletedAt && retirementBlockers.length === 0,
      defaultMode: 'REMOVE_TASK_ONLY' as const,
      publishedOutputsRetained: true,
      previewToken: stableHash(tokenState),
    },
  };
}

export async function previewSampleTaskDeletion(id: string) {
  return prisma.$transaction(async tx => (await loadDeleteState(tx, id)).preview, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}

export async function softDeleteSampleTask(input: {
  id: string;
  actorId: string;
  actorName: string;
  reason: unknown;
  confirmationCode: unknown;
  previewToken: unknown;
  expectedVersion: unknown;
  confirmed: unknown;
  clientMutationId: unknown;
  batchId?: string | null;
}) {
  const reason = cleanSampleText(input.reason, 500);
  const clientMutationId = cleanSampleText(input.clientMutationId, 100);
  const expectedVersion = Number(input.expectedVersion);
  if (!reason) throw new SampleTaskDeletionError('删除必须填写原因');
  if (!clientMutationId) throw new SampleTaskDeletionError('缺少删除操作编号，请刷新后重试');
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new SampleTaskDeletionError('任务版本无效，请重新查看删除影响');
  if (input.confirmed !== true) throw new SampleTaskDeletionError('请确认将任务移入回收站');

  try {
    return await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-task-delete:${input.id}`}))`;
      const replay = await tx.sampleTask.findUnique({ where: { id: input.id } });
      if (replay?.deletedAt && replay.lastDeleteMutationId === clientMutationId) {
        return { code: replay.code, recoverable: true as const, replayed: true as const };
      }
      const state = await loadDeleteState(tx, input.id);
      if (!state.preview.canDelete) throw new SampleTaskDeletionError(state.preview.blockers.join('；') || '当前任务不能删除', 409);
      if (input.confirmationCode !== state.task.code) throw new SampleTaskDeletionError('请输入完整样品任务编号确认删除');
      if (expectedVersion !== state.task.version) throw new SampleTaskDeletionError('任务已经被其他人修改，请重新查看删除影响', 409);
      if (input.previewToken !== state.preview.previewToken) throw new SampleTaskDeletionError('任务或关联数据已经变化，请重新查看删除影响', 409);
      const now = new Date();
      const claimed = await tx.sampleTask.updateMany({
        where: { id: state.task.id, version: expectedVersion, status: 'COMPLETED', deletedAt: null },
        data: {
          deletedAt: now,
          deletedById: input.actorId,
          deletedByName: input.actorName,
          deleteReason: reason,
          deleteBatchId: input.batchId || null,
          lastDeleteMutationId: clientMutationId,
          updatedById: input.actorId,
          updatedByName: input.actorName,
          version: { increment: 1 },
        },
      });
      if (claimed.count !== 1) throw new SampleTaskDeletionError('任务已经被其他人修改，请重新查看删除影响', 409);
      await tx.operationLog.create({ data: {
        userId: input.actorId,
        action: 'delete_sample_task',
        targetType: 'sample_task',
        targetId: state.task.id,
        detail: {
          taskCode: state.task.code,
          customerName: state.task.customerNameSnapshot,
          specification: state.task.specificationSnapshot,
          previousStatus: state.task.status,
          reason,
          impact: state.preview.impact,
          previewToken: state.preview.previewToken,
          clientMutationId,
          publishedOutputsRetained: true,
          objectDeletionCount: 0,
        },
      } });
      return { code: state.task.code, recoverable: true as const, replayed: false as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2025'].includes(error.code)) {
      throw new SampleTaskDeletionError('删除时任务或关联数据发生变化，操作已回滚，请刷新后重试', 409);
    }
    throw error;
  }
}

export async function restoreSampleTask(input: {
  id: string;
  actorId: string;
  actorName: string;
  reason: unknown;
  confirmationCode: unknown;
  expectedVersion: unknown;
  confirmed: unknown;
}) {
  const reason = cleanSampleText(input.reason, 500);
  const expectedVersion = Number(input.expectedVersion);
  if (!reason) throw new SampleTaskDeletionError('恢复必须填写原因');
  if (input.confirmed !== true) throw new SampleTaskDeletionError('请确认恢复样品任务');
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new SampleTaskDeletionError('任务版本无效，请刷新后重试');
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-task-delete:${input.id}`}))`;
    const task = await tx.sampleTask.findUnique({ where: { id: input.id } });
    if (!task || !task.deletedAt) throw new SampleTaskDeletionError('回收站中没有该样品任务', 404);
    if (input.confirmationCode !== task.code) throw new SampleTaskDeletionError('请输入完整样品任务编号确认恢复');
    if (task.version !== expectedVersion) throw new SampleTaskDeletionError('任务已经发生变化，请刷新后重试', 409);
    const restored = await tx.sampleTask.update({
      where: { id: task.id },
      data: {
        deletedAt: null,
        deletedById: null,
        deletedByName: null,
        deleteReason: null,
        deleteBatchId: null,
        lastDeleteMutationId: null,
        updatedById: input.actorId,
        updatedByName: input.actorName,
        version: { increment: 1 },
      },
      include: sampleTaskInclude,
    });
    await tx.operationLog.create({ data: {
      userId: input.actorId,
      action: 'restore_sample_task',
      targetType: 'sample_task',
      targetId: task.id,
      detail: { taskCode: task.code, reason, previousDeletedAt: task.deletedAt.toISOString(), previousDeleteReason: task.deleteReason },
    } });
    return serializeSampleTask(restored);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
}

export async function listDeletedSampleTasks() {
  const tasks = await prisma.sampleTask.findMany({
    where: { deletedAt: { not: null } },
    include: sampleTaskInclude,
    orderBy: [{ deletedAt: 'desc' }, { code: 'asc' }],
    take: 200,
  });
  return tasks.map(task => ({
    task: serializeSampleTask(task),
    deletedAt: task.deletedAt!.toISOString(),
    deletedBy: task.deletedByName,
    deleteReason: task.deleteReason,
    deleteBatchId: task.deleteBatchId,
  }));
}

export async function previewSampleTestCleanup(taskIds: string[], mode: SampleTaskDeleteMode) {
  const ids = [...new Set(taskIds.map(value => value.trim()).filter(Boolean))].sort();
  if (!ids.length) throw new SampleTaskDeletionError('请提供明确的样品任务 ID 清单');
  if (ids.length > 100) throw new SampleTaskDeletionError('单批最多处理 100 条样品任务');
  return prisma.$transaction(async tx => {
    const states = [];
    for (const id of ids) states.push(await loadDeleteState(tx, id));
    const items = states.map(state => state.preview);
    const blockers = items.flatMap(item => [
      ...item.blockers.map(message => `${item.task.code}：${message}`),
      ...(mode === 'RETIRE_TEST_OUTPUTS' ? item.retirementBlockers.map(message => `${item.task.code}：${message}`) : []),
    ]);
    const manifest = items.map(item => ({ id: item.task.id, code: item.task.code, version: item.task.version, previewToken: item.previewToken }));
    return {
      mode,
      items,
      blockers,
      canCommit: blockers.length === 0,
      manifest,
      previewToken: stableHash({ mode, manifest }),
      objectDeletionCount: 0,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20_000 });
}

export async function commitSampleTestCleanup(input: {
  taskIds: string[];
  mode: SampleTaskDeleteMode;
  actorId: string;
  actorName: string;
  reason: unknown;
  previewToken: unknown;
  confirmationText: unknown;
  confirmed: unknown;
  clientMutationId: unknown;
}) {
  const reason = cleanSampleText(input.reason, 500);
  const mutationId = cleanSampleText(input.clientMutationId, 100);
  if (!reason) throw new SampleTaskDeletionError('批量退役必须填写原因');
  if (!mutationId) throw new SampleTaskDeletionError('缺少批量操作编号');
  if (input.confirmed !== true) throw new SampleTaskDeletionError('请确认执行样品测试数据退役');
  const preview = await previewSampleTestCleanup(input.taskIds, input.mode);
  if (!preview.canCommit) throw new SampleTaskDeletionError(preview.blockers.join('；'), 409);
  if (input.previewToken !== preview.previewToken) throw new SampleTaskDeletionError('候选任务或关联数据已经变化，请重新预览', 409);
  if (input.confirmationText !== `退役 ${preview.items.length} 条样品测试数据`) {
    throw new SampleTaskDeletionError(`请输入“退役 ${preview.items.length} 条样品测试数据”确认`);
  }
  const requestHash = sampleRequestHash({ mode: input.mode, manifest: preview.manifest, reason });
  const replay = await prisma.sampleTaskCleanupBatch.findUnique({ where: { mutationId } });
  if (replay) {
    if (replay.requestHash !== requestHash) throw new SampleTaskDeletionError('同一批量操作编号对应了不同请求', 409);
    return replay.result;
  }

  return prisma.$transaction(async tx => {
    for (const item of preview.manifest) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-task-delete:${item.id}`}))`;
    }
    const batch = await tx.sampleTaskCleanupBatch.create({ data: {
      mutationId,
      requestHash,
      mode: input.mode,
      reason,
      manifest: preview.manifest,
      status: 'RUNNING',
      createdById: input.actorId,
      createdByName: input.actorName,
    } });
    const now = new Date();
    const results = [];
    for (const item of preview.manifest) {
      const state = await loadDeleteState(tx, item.id);
      if (state.preview.previewToken !== item.previewToken || state.task.version !== item.version) {
        throw new SampleTaskDeletionError(`${state.task.code} 已发生变化，整批操作已回滚`, 409);
      }
      if (input.mode === 'RETIRE_TEST_OUTPUTS') {
        if (!state.preview.canRetireTestOutputs) throw new SampleTaskDeletionError(`${state.task.code} 不满足自动退役条件`, 409);
        if (state.entryIds.length) {
          await tx.productDataRecord.updateMany({ where: { sourceSampleEntryId: { in: state.entryIds } }, data: { status: 'RETIRED' } });
        }
        const linkedProductDataRecordIds = state.publicationLinks.filter(link => link.targetType === 'product_data_record').map(link => link.targetId);
        if (linkedProductDataRecordIds.length) {
          await tx.productDataRecord.updateMany({ where: { id: { in: linkedProductDataRecordIds } }, data: { status: 'RETIRED' } });
        }
        if (state.bindings.length) {
          await tx.productConnectorParameterBinding.updateMany({
            where: { id: { in: state.bindings.map(binding => binding.id) } },
            data: { isCurrent: false, status: 'RETIRED', effectiveTo: now, retiredAt: now, retiredById: input.actorId, retireReason: reason },
          });
        }
        if (state.publishedFileIds.length) {
          await tx.drawingLibraryFile.updateMany({ where: { id: { in: state.publishedFileIds } }, data: { deletedAt: now, isCurrent: false } });
        }
        await tx.samplePublicationLink.updateMany({
          where: { sampleTaskId: state.task.id, publicationStatus: 'PUBLISHED' },
          data: { publicationStatus: 'RETIRED', retiredAt: now, retiredById: input.actorId, retireReason: reason },
        });
        for (const parameterId of state.connectorParameterIds) {
          const [activeBindings, manualBindings] = await Promise.all([
            tx.productConnectorParameterBinding.count({ where: { connectorParameterId: parameterId, isCurrent: true } }),
            tx.connectorAssemblyManualBinding.count({ where: { connectorParameterId: parameterId } }),
          ]);
          if (!activeBindings && !manualBindings) {
            await tx.connectorParameter.update({ where: { id: parameterId }, data: { status: 'RETIRED', deletedAt: now, updatedBy: input.actorName } });
          }
        }
      }
      await tx.sampleTask.update({
        where: { id: state.task.id },
        data: {
          deletedAt: now,
          deletedById: input.actorId,
          deletedByName: input.actorName,
          deleteReason: reason,
          deleteBatchId: batch.id,
          lastDeleteMutationId: mutationId,
          updatedById: input.actorId,
          updatedByName: input.actorName,
          version: { increment: 1 },
        },
      });
      results.push({ id: state.task.id, code: state.task.code, impact: state.preview.impact });
    }
    const result = { batchId: batch.id, mode: input.mode, taskCount: results.length, results, objectDeletionCount: 0 };
    await tx.sampleTaskCleanupBatch.update({ where: { id: batch.id }, data: { status: 'COMPLETED', result } });
    await tx.operationLog.create({ data: {
      userId: input.actorId,
      action: 'retire_sample_test_data',
      targetType: 'sample_task_cleanup_batch',
      targetId: batch.id,
      detail: { mode: input.mode, reason, requestHash, taskCodes: results.map(item => item.code), objectDeletionCount: 0 },
    } });
    return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
}
