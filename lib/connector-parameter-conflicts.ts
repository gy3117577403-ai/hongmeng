import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { sampleRequestHash, type SampleActor } from './sample-team';
import { publishStrippingParameter, SamplePublishError } from './sample-team-publish';

export const conflictInclude = { sourceEntry: { include: { task: { include: { drawingLibraryItem: { select: { id: true, specification: true } } } } } } } satisfies Prisma.ConnectorParameterConflictInclude;

async function currentBindings(tx: Prisma.TransactionClient, libraryItemId: string, positionKey: string) {
  return tx.productConnectorParameterBinding.findMany({ where: { drawingLibraryItemId: libraryItemId, positionKey, isCurrent: true, status: 'PUBLISHED' }, include: { connectorParameter: true }, orderBy: { id: 'asc' } });
}
function signature(rows: Awaited<ReturnType<typeof currentBindings>>) {
  return sampleRequestHash(rows.map(row => ({ id: row.id, version: row.version, updatedAt: row.updatedAt.toISOString(), parameterId: row.connectorParameterId, parameterUpdatedAt: row.connectorParameter.updatedAt.toISOString() })));
}
export async function connectorConflictDetail(tx: Prisma.TransactionClient, id: string) {
  const item = await tx.connectorParameterConflict.findUnique({ where: { id }, include: conflictInclude });
  if (!item) throw new SamplePublishError('待处理记录不存在', 404);
  const current = await currentBindings(tx, item.libraryItemId, item.positionKey);
  return { id: item.id, taskId: item.taskId, model: item.model, positionLabel: item.positionLabel, product: item.productSnapshot, candidate: item.sourceSnapshot, original: item.baseBindings, current: current.map(row => ({ id: row.id, version: row.version, values: { model: row.connectorParameter.model, outerPeelMm: row.connectorParameter.outerPeelMm, innerPeelMm: row.connectorParameter.innerPeelMm, insertionLengthMm: row.connectorParameter.insertionLengthMm, remark: row.connectorParameter.remark } })), currentSignature: signature(current), version: item.version, status: item.status, resolution: item.resolution, resolvedByName: item.resolvedByName, resolvedAt: item.resolvedAt, createdAt: item.createdAt, sampleStatus: item.sourceEntry.task.status };
}

export async function resolveConnectorConflict(id: string, input: { action: string; expectedVersion: number; currentSignature?: string; positionLabel?: string }, actor: SampleActor) {
  if (!['DISCARD', 'REPLACE', 'KEEP_SEPARATE'].includes(input.action) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1
    || (input.positionLabel !== undefined && typeof input.positionLabel !== 'string')
    || (input.currentSignature !== undefined && typeof input.currentSignature !== 'string')) throw new SamplePublishError('处理动作或版本无效');
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`connector-conflict:${id}`}))`;
    const item = await tx.connectorParameterConflict.findUnique({ where: { id }, include: conflictInclude });
    if (!item) throw new SamplePublishError('待处理记录不存在', 404);
    if (item.status !== 'PENDING') {
      if (item.resolution === input.action) return connectorConflictDetail(tx, id);
      throw new SamplePublishError('此记录已处理，请刷新查看结果', 409);
    }
    if (item.version !== input.expectedVersion) throw new SamplePublishError('待处理记录已更新，请刷新后重试', 409);
    if (input.action !== 'DISCARD' && (item.sourceEntry.deletedAt || item.sourceEntry.task.deletedAt)) throw new SamplePublishError('来源样品或记录已在回收站，请先恢复后再采用参数', 409);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-connector:${item.libraryItemId}`}))`;
    const current = await currentBindings(tx, item.libraryItemId, item.positionKey);
    // Lock the shared canonical parameters too; the ordinary revision editor uses this lock.
    for (const parameterId of [...new Set(current.map(row => row.connectorParameterId))].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`connector-parameter-edit:${parameterId}`}))`;
    }
    if (input.action !== 'DISCARD' && signature(await currentBindings(tx, item.libraryItemId, item.positionKey)) !== input.currentSignature) {
      throw new SamplePublishError('当前参数已被更新，请刷新对比后再处理', 409, 'CONNECTOR_CONFLICT_STALE');
    }
    let resultBindingId: string | null = null;
    if (input.action !== 'DISCARD') {
      const payload = { ...(item.sourceSnapshot as Prisma.JsonObject) };
      if (input.action === 'KEEP_SEPARATE') {
        const label = input.positionLabel?.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 160);
        if (!label || label.toLocaleLowerCase('zh-CN') === item.positionKey) throw new SamplePublishError('请填写不同的位置，例如 A 端 / B 端');
        payload.positionLabel = label;
      }
      const result = await publishStrippingParameter(tx, item.sourceEntry.task, { ...item.sourceEntry, payload }, actor, input.action === 'REPLACE' ? 'REPLACE_MATCHING' : 'APPEND', true);
      resultBindingId = result.entityId;
      await tx.sampleDataEntry.update({ where: { id: item.sourceEntryId }, data: { reviewStatus: 'PUBLISHED', publishedEntityType: result.entityType, publishedEntityId: result.entityId, publishedAt: new Date(), publishedById: actor.id, publishedByName: actor.name } });
      await tx.samplePublicationLink.upsert({ where: { sampleEntryId_targetType_targetId: { sampleEntryId: item.sourceEntryId, targetType: result.entityType, targetId: result.entityId } }, create: { sampleTaskId: item.taskId, sampleEntryId: item.sourceEntryId, targetType: result.entityType, targetId: result.entityId, sourceSnapshot: item.sourceSnapshot as Prisma.InputJsonValue, sourceHash: sampleRequestHash(item.sourceSnapshot) }, update: {} });
    } else {
      await tx.sampleDataEntry.update({ where: { id: item.sourceEntryId }, data: { publishedEntityType: 'connector_parameter_conflict_resolved' } });
    }
    await tx.connectorParameterConflict.update({ where: { id }, data: { status: 'RESOLVED', resolution: input.action, resultBindingId, resolvedAt: new Date(), resolvedById: actor.id, resolvedByName: actor.name, deletedAt: input.action === 'DISCARD' ? new Date() : null, version: { increment: 1 } } });
    await tx.operationLog.create({ data: { userId: actor.id, action: 'resolve_connector_parameter_conflict', targetType: 'connector_parameter_conflict', targetId: id, detail: { action: input.action, taskId: item.taskId, sourceEntryId: item.sourceEntryId, resultBindingId, positionLabel: input.positionLabel || item.positionLabel } } });
    return connectorConflictDetail(tx, id);
  }, { timeout: 20000 });
}
