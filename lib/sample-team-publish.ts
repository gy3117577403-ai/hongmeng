import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { reconcileProductionPlanDrawingLinks } from '@/lib/planning-product-link';
import { synchronizeDrawingLibraryWorkOrderStatus } from '@/lib/drawing-library-lifecycle';
import { cleanSampleText, sampleRequestHash, type SampleActor } from '@/lib/sample-team';
import { connectorParameterTechnicalFingerprint } from '@/lib/connector-parameters';
import type { SamplePublishModeDTO } from '@/types';

type SampleEntryForPublish = Prisma.SampleDataEntryGetPayload<Record<string, never>>;
type SamplePhotoForPublish = Prisma.SamplePhotoGetPayload<Record<string, never>>;
type SampleTaskForPublish = Prisma.SampleTaskGetPayload<{
  include: { drawingLibraryItem: { select: { id: true; specification: true } } };
}>;

export class SamplePublishError extends Error {
  constructor(message: string, public status = 400, public code = 'SAMPLE_PUBLISH_INVALID') {
    super(message);
  }
}

function payloadRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeConnectorModel(value: unknown): string | null {
  const text = cleanSampleText(value, 160)?.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return text ? text.toLocaleUpperCase('en-US') : null;
}

function normalizeDimension(value: unknown): string | null {
  const text = cleanSampleText(value, 80)?.normalize('NFKC').replace(/，/g, '.').replace(/\s+/g, '');
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? String(number) : text;
}

function normalizePosition(value: unknown): { label: string | null; key: string } {
  const label = cleanSampleText(value, 160)?.normalize('NFKC').replace(/\s+/g, ' ').trim() || null;
  return { label, key: label?.toLocaleLowerCase('zh-CN') || '' };
}

function sameConnectorTechnicalValues(
  value: { model: string | null; outerPeelMm: string | null; innerPeelMm: string | null; insertionLengthMm: string | null; remark: string | null },
  expected: { model: string; outerPeelMm: string | null; innerPeelMm: string | null; insertionLengthMm: string | null; remark: string | null },
) {
  return normalizeConnectorModel(value.model) === expected.model
    && normalizeDimension(value.outerPeelMm) === expected.outerPeelMm
    && normalizeDimension(value.innerPeelMm) === expected.innerPeelMm
    && normalizeDimension(value.insertionLengthMm) === expected.insertionLengthMm
    && (cleanSampleText(value.remark, 500) || null) === expected.remark;
}

async function recordEntryPublication(
  tx: Prisma.TransactionClient,
  task: SampleTaskForPublish,
  entry: SampleEntryForPublish,
  targetType: string,
  targetId: string,
  targetChildId?: string | null,
) {
  const existing = await tx.samplePublicationLink.findFirst({ where: { sampleEntryId: entry.id, targetType, targetId } });
  if (existing) return existing;
  return tx.samplePublicationLink.create({ data: {
    sampleTaskId: task.id,
    sampleEntryId: entry.id,
    targetType,
    targetId,
    targetChildId: targetChildId || null,
    sourceSnapshot: entry.payload === null ? Prisma.JsonNull : entry.payload as Prisma.InputJsonValue,
    sourceHash: sampleRequestHash(entry.payload),
  } });
}

async function recordPhotoPublication(
  tx: Prisma.TransactionClient,
  task: SampleTaskForPublish,
  photo: SamplePhotoForPublish,
  targetId: string,
) {
  const existing = await tx.samplePublicationLink.findFirst({ where: { samplePhotoId: photo.id, targetType: 'drawing_library_file', targetId } });
  if (existing) return existing;
  return tx.samplePublicationLink.create({ data: {
    sampleTaskId: task.id,
    samplePhotoId: photo.id,
    targetType: 'drawing_library_file',
    targetId,
    sourceSnapshot: { category: photo.category, caption: photo.caption, originalName: photo.originalName, sha256: photo.sha256 },
    sourceHash: sampleRequestHash({ category: photo.category, caption: photo.caption, originalName: photo.originalName, sha256: photo.sha256 }),
  } });
}

function hasMeaningfulValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.some(hasMeaningfulValue);
  if (value && typeof value === 'object') return Object.values(value).some(hasMeaningfulValue);
  return false;
}

function positiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function measurementAverage(payload: Record<string, unknown>): number | null {
  const values = Array.isArray(payload.measurements)
    ? payload.measurements.map(value => positiveNumber(
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>).value
          : value,
      )).filter((value): value is number => value !== null)
    : [];
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function versionMinor(version?: string | null): number {
  const match = String(version || '').match(/^V1\.(\d+)$/i);
  return match ? Number(match[1]) : -1;
}

async function syncProcessTimeDraft(
  tx: Prisma.TransactionClient,
  task: SampleTaskForPublish,
  entry: SampleEntryForPublish,
  actor: SampleActor,
  publishMode: SamplePublishModeDTO,
) {
  const payload = payloadRecord(entry.payload);
  const processDefinitionId = cleanSampleText(payload.processDefinitionId, 80);
  if (!processDefinitionId) {
    throw new SamplePublishError('该工序工时尚未关联工序库，可先通过留档或补充工序后再同步');
  }
  const definition = await tx.processDefinition.findFirst({
    where: { id: processDefinitionId, isActive: true },
    select: { id: true, name: true },
  });
  if (!definition) throw new SamplePublishError('关联工序已停用或不存在，请重新选择工序');

  const recommendedSeconds = positiveNumber(payload.recommendedSeconds) ?? measurementAverage(payload);
  if (recommendedSeconds === null) {
    throw new SamplePublishError('该工序工时没有可发布的实测值，可先通过留档或补充数据后再同步');
  }
  const setupSeconds = nonNegativeNumber(payload.setupSeconds) ?? 0;
  const occurrencesRaw = Number(payload.occurrences);
  const occurrences = Number.isInteger(occurrencesRaw) && occurrencesRaw > 0 && occurrencesRaw <= 1000
    ? occurrencesRaw
    : 1;
  const timeBasis = payload.timeBasis === 'per_batch' ? 'per_batch' : 'per_unit';
  const unitLabel = cleanSampleText(payload.unitLabel, 20) || '件';
  const remark = cleanSampleText(payload.remark, 500) || cleanSampleText(entry.label, 200);

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-product-time:${task.drawingLibraryItemId}`}))`;
  let draft = await tx.productTimeProfile.findFirst({
    where: { drawingLibraryItemId: task.drawingLibraryItemId, status: 'draft' },
    select: { id: true, version: true, revision: true, remark: true },
  });
  if (!draft) {
    const latest = await tx.productTimeProfile.findFirst({
      where: { drawingLibraryItemId: task.drawingLibraryItemId },
      orderBy: { version: 'desc' },
      include: { entries: { orderBy: { position: 'asc' } } },
    });
    draft = await tx.productTimeProfile.create({
      data: {
        drawingLibraryItemId: task.drawingLibraryItemId,
        version: (latest?.version || 0) + 1,
        revision: 0,
        status: 'draft',
        sourceType: 'sample_task',
        reportingPolicy: latest?.reportingPolicy || 'free_sequence',
        remark: `样品任务 ${task.code} 审核同步`,
        createdById: actor.id,
        updatedById: actor.id,
      },
      select: { id: true, version: true, revision: true, remark: true },
    });
    if (latest?.entries.length) {
      await tx.productProcessTimeEntry.createMany({
        data: latest.entries.map(item => ({
          profileId: draft!.id,
          processDefinitionId: item.processDefinitionId,
          occurrenceKey: item.occurrenceKey,
          position: item.position,
          sequenceGroup: item.sequenceGroup,
          timeBasis: item.timeBasis,
          unitMilliseconds: item.unitMilliseconds,
          actionMilliseconds: item.actionMilliseconds,
          occurrences: item.occurrences,
          setupMilliseconds: item.setupMilliseconds,
          unitLabel: item.unitLabel,
          reportQuantityBasis: item.reportQuantityBasis,
          reportUnitLabel: item.reportUnitLabel,
          countsForEfficiency: item.countsForEfficiency,
          isCritical: item.isCritical,
          remark: item.remark,
        })),
      });
    }
  }

  const existingEntries = await tx.productProcessTimeEntry.findMany({
    where: { profileId: draft.id },
    orderBy: { position: 'asc' },
  });
  const matching = existingEntries.find(item => item.processDefinitionId === definition.id);
  const data = {
    processDefinitionId: definition.id,
    timeBasis,
    unitMilliseconds: Math.max(1, Math.round(recommendedSeconds * 1000)),
    actionMilliseconds: null,
    occurrences,
    setupMilliseconds: Math.max(0, Math.round(setupSeconds * 1000)),
    unitLabel,
    reportQuantityBasis: 'product',
    reportUnitLabel: unitLabel,
    countsForEfficiency: payload.countsForEfficiency !== false,
    isCritical: payload.isCritical === true,
    remark: [remark, `来源：${task.code}`].filter(Boolean).join(' · ').slice(0, 500),
  };

  let productTimeEntryId: string;
  if (publishMode === 'REPLACE_MATCHING' && matching) {
    const updated = await tx.productProcessTimeEntry.update({
      where: { id: matching.id },
      data,
      select: { id: true },
    });
    productTimeEntryId = updated.id;
  } else {
    const created = await tx.productProcessTimeEntry.create({
      data: {
        ...data,
        profileId: draft.id,
        occurrenceKey: randomUUID(),
        position: (existingEntries.at(-1)?.position || 0) + 1,
        sequenceGroup: (existingEntries.at(-1)?.sequenceGroup || 0) + 1,
      },
      select: { id: true },
    });
    productTimeEntryId = created.id;
  }
  const profileUpdated = await tx.productTimeProfile.updateMany({
    where: { id: draft.id, revision: draft.revision, status: 'draft' },
    data: {
      revision: { increment: 1 },
      sourceType: 'sample_task',
      updatedById: actor.id,
      remark: [draft.remark, `已合入 ${task.code}`].filter(Boolean).join('；').slice(0, 500),
    },
  });
  if (profileUpdated.count !== 1) {
    throw new SamplePublishError('产品工时草稿已被其他人修改，请刷新样品任务后重试', 409, 'SAMPLE_PRODUCT_TIME_CONFLICT');
  }
  return {
    reviewStatus: 'APPROVED' as const,
    entityType: 'product_time_draft',
    entityId: draft.id,
    detail: { productTimeEntryId, profileVersion: draft.version },
  };
}

async function publishStructuredRecord(
  tx: Prisma.TransactionClient,
  task: SampleTaskForPublish,
  entry: SampleEntryForPublish,
  actor: SampleActor,
  publishMode: SamplePublishModeDTO,
) {
  const kind = entry.kind === 'NOTICE' ? 'NOTICE' : entry.kind === 'CUSTOM' ? 'CUSTOM' : 'MATERIAL';
  const label = cleanSampleText(entry.label, 200);
  const payload = payloadRecord(entry.payload);
  if (!label && !Object.values(payload).some(hasMeaningfulValue)) {
    throw new SamplePublishError('该记录没有可发布内容，可选择通过留档');
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-product-data:${task.drawingLibraryItemId}:${kind}`}))`;
  const latest = await tx.productDataRecord.aggregate({
    where: { drawingLibraryItemId: task.drawingLibraryItemId, kind },
    _max: { version: true },
  });
  let supersedesRecordId: string | null = null;
  if (publishMode === 'REPLACE_MATCHING') {
    const matching = await tx.productDataRecord.findFirst({
      where: {
        drawingLibraryItemId: task.drawingLibraryItemId,
        kind,
        status: 'PUBLISHED',
        ...(label ? { label: { equals: label, mode: 'insensitive' } } : { label: null }),
      },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (matching) {
      supersedesRecordId = matching.id;
      await tx.productDataRecord.update({ where: { id: matching.id }, data: { status: 'SUPERSEDED' } });
    }
  }
  const record = await tx.productDataRecord.create({
    data: {
      drawingLibraryItemId: task.drawingLibraryItemId,
      kind,
      label,
      payload: payload as Prisma.InputJsonObject,
      version: (latest._max.version || 0) + 1,
      status: 'PUBLISHED',
      sourceType: 'SAMPLE_TASK',
      sourceSampleEntryId: entry.id,
      supersedesRecordId,
      publishedById: actor.id,
      publishedByName: actor.name,
    },
    select: { id: true, version: true },
  });
  await tx.drawingLibraryItem.update({ where: { id: task.drawingLibraryItemId }, data: { updatedAt: new Date() } });
  return {
    reviewStatus: 'PUBLISHED' as const,
    entityType: 'product_data_record',
    entityId: record.id,
    detail: { version: record.version, kind },
  };
}

async function publishStrippingParameter(
  tx: Prisma.TransactionClient,
  task: SampleTaskForPublish,
  entry: SampleEntryForPublish,
  actor: SampleActor,
  publishMode: SamplePublishModeDTO,
) {
  const payload = payloadRecord(entry.payload);
  const model = normalizeConnectorModel(payload.model);
  const outerPeelMm = normalizeDimension(payload.outerPeelMm);
  const innerPeelMm = normalizeDimension(payload.innerPeelMm);
  const insertionLengthMm = normalizeDimension(payload.insertionLengthMm);
  const position = normalizePosition(payload.positionLabel || entry.label);
  const positionLabel = position.label;
  const remark = cleanSampleText(payload.remark, 500);
  if (!model) throw new SamplePublishError('剥皮参数缺少连接器型号，可选择仅留档或补充后再确认', 409, 'SAMPLE_CONNECTOR_MODEL_REQUIRED');
  if (![outerPeelMm, innerPeelMm, insertionLengthMm].some(Boolean)) throw new SamplePublishError('外剥、内剥、入长至少填写一项，可选择仅留档', 409, 'SAMPLE_CONNECTOR_DIMENSION_REQUIRED');
  const technicalFingerprint = connectorParameterTechnicalFingerprint({ model, outerPeelMm, innerPeelMm, insertionLengthMm, remark });
  const sourcePayloadHash = sampleRequestHash(payload);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-connector:${task.drawingLibraryItemId}`}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`connector-parameter:${technicalFingerprint}`}))`;
  const replay = await tx.productConnectorParameterBinding.findUnique({
    where: { sourceSampleEntryId: entry.id },
    include: { connectorParameter: true },
  });
  if (replay) {
    return {
      reviewStatus: 'PUBLISHED' as const,
      entityType: 'connector_parameter_binding',
      entityId: replay.id,
      detail: { connectorParameterId: replay.connectorParameterId, version: replay.version, reused: true },
    };
  }
  const latest = await tx.productConnectorParameterBinding.aggregate({
    where: { drawingLibraryItemId: task.drawingLibraryItemId },
    _max: { version: true },
  });
  const currentBindings = await tx.productConnectorParameterBinding.findMany({
    where: { drawingLibraryItemId: task.drawingLibraryItemId, positionKey: position.key, isCurrent: true, status: 'PUBLISHED' },
    include: { connectorParameter: true },
    orderBy: [{ version: 'desc' }, { id: 'asc' }],
  });
  const expectedValues = { model, outerPeelMm, innerPeelMm, insertionLengthMm, remark };
  const exactCurrent = currentBindings.find(binding => binding.connectorParameter.technicalFingerprint === technicalFingerprint
    || sameConnectorTechnicalValues(binding.connectorParameter, expectedValues));
  if (exactCurrent) {
    return {
      reviewStatus: 'PUBLISHED' as const,
      entityType: 'connector_parameter_binding',
      entityId: exactCurrent.id,
      detail: { connectorParameterId: exactCurrent.connectorParameterId, version: exactCurrent.version, reused: true },
    };
  }
  if (currentBindings.length && publishMode !== 'REPLACE_MATCHING') {
    const label = positionLabel || '未标明位置';
    throw new SamplePublishError(
      `${label}已经存在不同的当前剥皮参数，请在审核编辑中选择“替换当前版本”，或补充 A/B 端等位置后再确认`,
      409,
      'SAMPLE_CONNECTOR_PARAMETER_CONFLICT',
    );
  }
  const replaced = currentBindings[0] || null;
  if (publishMode === 'REPLACE_MATCHING') {
    await tx.productConnectorParameterBinding.updateMany({
      where: {
        drawingLibraryItemId: task.drawingLibraryItemId,
        isCurrent: true,
        positionKey: position.key,
      },
      data: { isCurrent: false, status: 'SUPERSEDED', effectiveTo: new Date() },
    });
  }
  let parameter = await tx.connectorParameter.findFirst({
    where: {
      deletedAt: null,
      status: 'PUBLISHED',
      OR: [
        { technicalFingerprint },
        { model: { equals: model, mode: 'insensitive' }, outerPeelMm, innerPeelMm, insertionLengthMm, remark },
      ],
    },
    orderBy: [{ revision: 'desc' }, { createdAt: 'asc' }],
    select: { id: true, revision: true },
  });
  if (!parameter) {
    const modelRevisions = await tx.connectorParameter.findMany({
      where: { model: { equals: model, mode: 'insensitive' } },
      select: { revision: true },
    });
    parameter = await tx.connectorParameter.create({
      data: {
        model,
        outerPeelMm,
        innerPeelMm,
        insertionLengthMm,
        remark,
        technicalFingerprint,
        sourceType: 'SAMPLE_REVIEW',
        revision: modelRevisions.reduce((max, item) => Math.max(max, item.revision), 0) + 1,
        status: 'PUBLISHED',
        supersedesParameterId: replaced?.connectorParameterId || null,
        lockedAt: new Date(),
        createdBy: actor.name,
        updatedBy: actor.name,
      },
      select: { id: true, revision: true },
    });
  } else {
    await tx.connectorParameter.update({ where: { id: parameter.id }, data: { technicalFingerprint, lockedAt: new Date() } });
  }
  const parameterSnapshot = {
    model,
    outerPeelMm,
    innerPeelMm,
    insertionLengthMm,
    remark,
    revision: parameter.revision,
    technicalFingerprint,
  };
  const binding = await tx.productConnectorParameterBinding.create({
    data: {
      drawingLibraryItemId: task.drawingLibraryItemId,
      connectorParameterId: parameter.id,
      positionLabel,
      positionKey: position.key,
      version: (latest._max.version || 0) + 1,
      status: 'PUBLISHED',
      sourceType: 'SAMPLE_REVIEW',
      sourceSampleTaskId: task.id,
      sourceSubmissionId: task.activeSubmissionId,
      sourceSampleEntryId: entry.id,
      sourcePayloadHash,
      parameterSnapshot,
      supersedesBindingId: replaced?.id || null,
      publishedById: actor.id,
      publishedByName: actor.name,
    },
    select: { id: true, version: true },
  });
  await tx.operationLog.create({ data: {
    userId: actor.id,
    action: replaced ? 'replace_connector_parameter_from_sample' : 'publish_connector_parameter_from_sample',
    targetType: 'product_connector_parameter_binding',
    targetId: binding.id,
    detail: { taskId: task.id, taskCode: task.code, sourceEntryId: entry.id, connectorParameterId: parameter.id, technicalFingerprint, positionLabel, sourcePayloadHash, replacedBindingId: replaced?.id || null, decision: replaced ? 'REPLACE' : 'CREATE_OR_REUSE' },
  } });
  await tx.drawingLibraryItem.update({ where: { id: task.drawingLibraryItemId }, data: { updatedAt: new Date() } });
  return {
    reviewStatus: 'PUBLISHED' as const,
    entityType: 'connector_parameter_binding',
    entityId: binding.id,
    detail: { connectorParameterId: parameter.id, version: binding.version },
  };
}

export async function publishSampleEntry(
  tx: Prisma.TransactionClient,
  task: SampleTaskForPublish,
  entry: SampleEntryForPublish,
  actor: SampleActor,
  publishMode: SamplePublishModeDTO,
) {
  if (publishMode === 'RECORD_ONLY') {
    return { reviewStatus: 'APPROVED' as const, entityType: null, entityId: null, detail: {} };
  }
  const result = entry.kind === 'PROCESS_TIME'
    ? await syncProcessTimeDraft(tx, task, entry, actor, publishMode)
    : entry.kind === 'STRIPPING'
      ? await publishStrippingParameter(tx, task, entry, actor, publishMode)
      : entry.kind === 'MATERIAL' || entry.kind === 'NOTICE' || entry.kind === 'CUSTOM'
        ? await publishStructuredRecord(tx, task, entry, actor, publishMode)
        : null;
  if (!result) throw new SamplePublishError('不支持的数据类型');
  if (result.entityId && result.entityType) {
    const detail = result.detail as Record<string, unknown>;
    await recordEntryPublication(tx, task, entry, result.entityType, result.entityId, typeof detail.productTimeEntryId === 'string' ? detail.productTimeEntryId : null);
  }
  return result;
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

export async function publishSamplePhoto(
  tx: Prisma.TransactionClient,
  task: SampleTaskForPublish,
  photo: SamplePhotoForPublish,
  actor: SampleActor,
  options: { deferLifecycleSync?: boolean } = {},
) {
  if (photo.publishedFileId) {
    await recordPhotoPublication(tx, task, photo, photo.publishedFileId);
    return { entityType: 'drawing_library_file', entityId: photo.publishedFileId, detail: { reused: true } };
  }
  const categoryCode = photoCategoryCode(photo.category);
  const category = await tx.resourceCategory.findUnique({ where: { code: categoryCode } });
  if (!category) throw new SamplePublishError(`资料分类 ${categoryCode} 尚未初始化`, 500, 'SAMPLE_CATEGORY_MISSING');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-photo:${task.drawingLibraryItemId}:${category.id}`}))`;
  const files = await tx.drawingLibraryFile.findMany({
    where: { libraryItemId: task.drawingLibraryItemId, categoryId: category.id },
    select: { version: true },
  });
  const version = `V1.${files.reduce((max, file) => Math.max(max, versionMinor(file.version)), -1) + 1}`;
  const mediaAsset = await tx.mediaAsset.upsert({
    where: { originalObjectKey: photo.objectKey },
    create: { originalObjectKey: photo.objectKey, sha256: photo.sha256, mimeType: photo.mimeType, byteSize: photo.size },
    update: { sha256: photo.sha256, mimeType: photo.mimeType, byteSize: photo.size },
    select: { id: true },
  });
  const file = await tx.drawingLibraryFile.create({
    data: {
      libraryItemId: task.drawingLibraryItemId,
      categoryId: category.id,
      originalName: photo.originalName,
      displayName: photo.caption || null,
      mimeType: photo.mimeType,
      size: photo.size,
      version,
      objectKey: photo.objectKey,
      mediaAssetId: mediaAsset.id,
      sha256: photo.sha256,
      sourceType: 'SAMPLE_PHOTO',
      sourceEntityId: photo.id,
      uploadedById: actor.id,
      remark: [`样品任务 ${task.code}`, photo.caption].filter(Boolean).join(' · ').slice(0, 500),
    },
    select: { id: true },
  });
  await tx.samplePhoto.update({ where: { id: photo.id }, data: { publishedFileId: file.id, mediaAssetId: mediaAsset.id } });
  await recordPhotoPublication(tx, task, photo, file.id);
  if (!options.deferLifecycleSync) {
    await finalizeSamplePhotoPublication(tx, task.drawingLibraryItemId);
  }
  return { entityType: 'drawing_library_file', entityId: file.id, detail: { categoryCode, version } };
}

export async function finalizeSamplePhotoPublication(
  tx: Prisma.TransactionClient,
  drawingLibraryItemId: string,
) {
  await tx.drawingLibraryItem.update({ where: { id: drawingLibraryItemId }, data: { updatedAt: new Date() } });
  await reconcileProductionPlanDrawingLinks(tx, { drawingLibraryItemId });
  await synchronizeDrawingLibraryWorkOrderStatus(tx, drawingLibraryItemId);
}
