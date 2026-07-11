import type {
  ConnectorAssemblyManualImportBatch,
  ConnectorAssemblyManualImportItem,
  Prisma,
} from '@prisma/client';
import type {
  ConnectorManualBulkAssetInputDTO,
  ConnectorManualBulkCandidateDTO,
  ConnectorManualMetadataConfidence,
  ConnectorManualImportBatchDTO,
  ConnectorManualImportItemDTO,
} from '@/types';
import { prisma } from '@/lib/prisma';

const supportedMimeTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const confidenceValues = new Set<ConnectorManualMetadataConfidence>(['confirmed', 'detected', 'needs_review']);

function text(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function textList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(item => text(item, maxLength)).filter(Boolean))).slice(0, maxItems);
}

function assets(value: unknown): ConnectorManualBulkAssetInputDTO[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map(item => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      fileName: text(row.fileName, 260),
      relativePath: text(row.relativePath, 1000),
      size: Math.max(0, Number(row.size || 0) || 0),
      mimeType: text(row.mimeType, 100),
      hash: text(row.hash, 128).toLowerCase(),
    };
  });
}

function metadataConfidence(value: unknown): ConnectorManualBulkCandidateDTO['metadataConfidence'] {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const confidence = (key: string, fallback: ConnectorManualMetadataConfidence): ConnectorManualMetadataConfidence => {
    const current = String(row[key] || '') as ConnectorManualMetadataConfidence;
    return confidenceValues.has(current) ? current : fallback;
  };
  return {
    defaultTitle: confidence('defaultTitle', 'confirmed'),
    detectedTitle: confidence('detectedTitle', 'needs_review'),
    manufacturer: confidence('manufacturer', 'needs_review'),
    family: confidence('family', 'needs_review'),
    revision: confidence('revision', 'needs_review'),
    issuedAt: confidence('issuedAt', 'needs_review'),
    models: confidence('models', 'needs_review'),
    chapters: confidence('chapters', 'needs_review'),
  };
}

export function parseBulkManualCandidate(value: unknown): { candidate: ConnectorManualBulkCandidateDTO; errors: string[] } {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const fileMode = text(input.fileMode, 20) === 'IMAGE_SET' ? 'IMAGE_SET' : 'PDF';
  const candidateAssets = assets(input.assets);
  const candidate: ConnectorManualBulkCandidateDTO = {
    clientId: text(input.clientId, 160),
    relativePath: text(input.relativePath, 1000),
    fileName: text(input.fileName, 260),
    size: Math.max(0, Number(input.size || 0) || 0),
    mimeType: text(input.mimeType, 100),
    fileMode,
    defaultTitle: text(input.defaultTitle, 240),
    detectedTitle: text(input.detectedTitle, 240),
    manufacturerCandidate: text(input.manufacturerCandidate, 160),
    familyCandidate: text(input.familyCandidate, 160),
    revisionCandidate: text(input.revisionCandidate, 80),
    issuedAtCandidate: text(input.issuedAtCandidate, 40),
    modelCandidates: textList(input.modelCandidates, 24, 80),
    keywordCandidates: textList(input.keywordCandidates, 40, 100),
    chapterCandidates: Array.isArray(input.chapterCandidates)
      ? input.chapterCandidates.slice(0, 100).map(item => {
        const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        return { title: text(row.title, 160), pageStart: Number(row.pageStart || 0), pageEnd: Number(row.pageEnd || row.pageStart || 0) };
      }).filter(item => item.title && Number.isInteger(item.pageStart) && Number.isInteger(item.pageEnd) && item.pageStart > 0 && item.pageEnd >= item.pageStart)
      : [],
    metadataConfidence: metadataConfidence(input.metadataConfidence),
    pageCount: Math.max(0, Number(input.pageCount || 0) || 0),
    hash: text(input.hash, 128).toLowerCase(),
    parseFailed: input.parseFailed === true,
    warnings: textList(input.warnings, 100, 300),
    assets: candidateAssets,
  };
  const errors: string[] = [];
  if (!candidate.clientId) errors.push('缺少 clientId');
  if (!candidate.fileName) errors.push('缺少文件名');
  if (!candidate.defaultTitle) errors.push('缺少默认说明书名称');
  if (candidate.size <= 0) errors.push('文件为空');
  if (fileMode === 'PDF' && candidateAssets.length !== 1) errors.push('PDF 候选必须包含一个文件');
  if (fileMode === 'IMAGE_SET' && (candidateAssets.length < 1 || candidateAssets.length > 50)) errors.push('图片集必须包含 1-50 张图片');
  if (candidateAssets.some(asset => asset.size <= 0 || !asset.fileName)) errors.push('包含空文件或无文件名资产');
  if (candidateAssets.some(asset => asset.mimeType && !supportedMimeTypes.has(asset.mimeType))) errors.push('包含不支持的文件类型');
  if (candidateAssets.some(asset => !/^[a-f0-9]{64}$/.test(asset.hash))) errors.push('缺少有效 SHA-256');
  return { candidate, errors };
}

function jsonStrings(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : [];
}

export function serializeManualImportItem(item: ConnectorAssemblyManualImportItem): ConnectorManualImportItemDTO {
  return {
    id: item.id,
    batchId: item.batchId,
    clientId: item.clientId,
    fileName: item.fileName,
    relativePath: item.relativePath,
    fileMode: item.fileMode as 'PDF' | 'IMAGE_SET',
    fileHash: item.fileHash,
    action: item.action,
    status: item.status,
    title: item.title,
    revision: item.revision,
    manualId: item.manualId,
    versionId: item.versionId,
    pageCount: item.pageCount,
    detectedTitle: item.detectedTitle,
    errorMessage: item.errorMessage,
    warnings: jsonStrings(item.warningsJson),
    attemptCount: item.attemptCount,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function serializeManualImportBatch(
  batch: ConnectorAssemblyManualImportBatch & { items?: ConnectorAssemblyManualImportItem[] },
): ConnectorManualImportBatchDTO {
  return {
    id: batch.id,
    sourceName: batch.sourceName,
    totalCount: batch.totalCount,
    readyCount: batch.readyCount,
    successCount: batch.successCount,
    duplicateCount: batch.duplicateCount,
    failedCount: batch.failedCount,
    skippedCount: batch.skippedCount,
    status: batch.status,
    createdBy: batch.createdBy,
    startedAt: batch.startedAt?.toISOString() || null,
    completedAt: batch.completedAt?.toISOString() || null,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
    items: (batch.items || []).map(serializeManualImportItem),
  };
}

export async function refreshManualImportBatch(batchId: string): Promise<void> {
  const grouped = await prisma.connectorAssemblyManualImportItem.groupBy({
    by: ['status'],
    where: { batchId },
    _count: { _all: true },
  });
  const counts = new Map(grouped.map(row => [row.status, row._count._all]));
  const successCount = counts.get('success') || 0;
  const duplicateCount = counts.get('duplicate') || 0;
  const failedCount = counts.get('failed') || 0;
  const skippedCount = (counts.get('skipped') || 0) + (counts.get('cancelled') || 0);
  const pendingCount = (counts.get('pending') || 0) + (counts.get('processing') || 0);
  const status = pendingCount > 0 ? 'uploading' : failedCount > 0 ? (successCount > 0 ? 'completed_with_errors' : 'failed') : 'completed';
  await prisma.connectorAssemblyManualImportBatch.update({
    where: { id: batchId },
    data: {
      successCount,
      duplicateCount,
      failedCount,
      skippedCount,
      status,
      completedAt: pendingCount === 0 ? new Date() : null,
    },
  });
}

export function bulkSearchText(input: {
  fileNames: string[];
  title: string;
  detectedTitle?: string;
  relativePaths: string[];
  manufacturer?: string;
  family?: string;
  revision?: string;
  models?: string[];
  keywords?: string[];
  chapters?: Array<{ title: string }>;
  pdfText?: string;
}): string {
  return [
    ...input.fileNames,
    input.title,
    input.detectedTitle || '',
    ...input.relativePaths,
    input.manufacturer || '',
    input.family || '',
    input.revision || '',
    ...(input.models || []),
    ...(input.keywords || []),
    ...(input.chapters || []).map(item => item.title),
    input.pdfText || '',
  ].filter(Boolean).join('\n').slice(0, 500_000);
}
