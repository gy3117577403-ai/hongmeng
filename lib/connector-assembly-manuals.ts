import type {
  ConnectorAssemblyManual,
  ConnectorAssemblyManualAsset,
  ConnectorAssemblyManualVersion,
  ConnectorParameter,
} from '@prisma/client';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sanitizeConnectorManualManufacturer } from '@/lib/connector-manual-parser';
import { safeFilename } from '@/lib/validation';

export const MANUAL_FILE_MODES = ['PDF', 'IMAGE_SET'] as const;
export type ManualFileMode = (typeof MANUAL_FILE_MODES)[number];
export const MANUAL_PDF_MAX_BYTES = 100 * 1024 * 1024;
export const MANUAL_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const MANUAL_IMAGE_MAX_COUNT = 50;
export const MANUAL_PDF_MIME = 'application/pdf';
export const MANUAL_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type ManualTocItem = {
  title: string;
  pageStart: number;
  pageEnd: number;
};

type ManualInput = {
  title?: unknown;
  manufacturer?: unknown;
  family?: unknown;
  documentNo?: unknown;
  summary?: unknown;
  keywords?: unknown;
};

type VersionInput = {
  revision?: unknown;
  issuedAt?: unknown;
  fileMode?: unknown;
  isLatest?: unknown;
  status?: unknown;
  tocJson?: unknown;
  remark?: unknown;
};

type ManualWithRelations = ConnectorAssemblyManual & {
  versions?: Array<ConnectorAssemblyManualVersion & { assets: ConnectorAssemblyManualAsset[] }>;
  bindings?: Array<{ connectorParameter: ConnectorParameter }>;
};

function optionalText(value: unknown, max: number): string | null {
  const next = String(value ?? '').trim();
  return next ? next.slice(0, max) : null;
}

function requiredText(value: unknown, label: string, max: number, errors: string[]): string {
  const next = String(value ?? '').trim();
  if (!next) errors.push(`${label}不能为空`);
  return next.slice(0, max);
}

function optionalDate(value: unknown, errors: string[]): Date | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const next = new Date(text);
  if (Number.isNaN(next.getTime())) {
    errors.push('发布日期格式不正确');
    return null;
  }
  return next;
}

export function parseManualInput(input: ManualInput, options: { partial?: boolean } = {}) {
  const errors: string[] = [];
  const partial = !!options.partial;
  const data: {
    title?: string;
    manufacturer?: string | null;
    family?: string | null;
    documentNo?: string | null;
    summary?: string | null;
    keywords?: string | null;
  } = {};

  if (!partial || input.title !== undefined) data.title = requiredText(input.title, '说明书名称', 240, errors);
  if (!partial || input.manufacturer !== undefined) data.manufacturer = optionalText(sanitizeConnectorManualManufacturer(String(input.manufacturer ?? '')), 160);
  if (!partial || input.family !== undefined) data.family = optionalText(input.family, 160);
  if (!partial || input.documentNo !== undefined) data.documentNo = optionalText(input.documentNo, 160);
  if (!partial || input.summary !== undefined) data.summary = optionalText(input.summary, 2000);
  if (!partial || input.keywords !== undefined) data.keywords = optionalText(input.keywords, 1200);
  return { data, errors };
}

export function parseManualToc(value: unknown, pageCount?: number | null): { items: ManualTocItem[]; error?: string } {
  if (value === null || value === undefined || value === '') return { items: [] };
  let raw = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch {
      return { items: [], error: '章节目录不是有效 JSON' };
    }
  }
  if (!Array.isArray(raw)) return { items: [], error: '章节目录必须是数组' };
  if (raw.length > 100) return { items: [], error: '章节目录不能超过 100 条' };
  const items: ManualTocItem[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const row = raw[index];
    if (!row || typeof row !== 'object') return { items: [], error: `第 ${index + 1} 条章节格式不正确` };
    const record = row as Record<string, unknown>;
    const title = String(record.title ?? '').trim().slice(0, 160);
    const pageStart = Number(record.pageStart);
    const pageEnd = Number(record.pageEnd ?? record.pageStart);
    if (!title || !Number.isInteger(pageStart) || !Number.isInteger(pageEnd) || pageStart < 1 || pageEnd < pageStart) {
      return { items: [], error: `第 ${index + 1} 条章节的标题或页码不正确` };
    }
    if (pageCount && pageEnd > pageCount) return { items: [], error: `第 ${index + 1} 条章节页码超过文件总页数` };
    items.push({ title, pageStart, pageEnd });
  }
  return { items };
}

export function parseVersionInput(input: VersionInput, options: { partial?: boolean; pageCount?: number | null } = {}) {
  const errors: string[] = [];
  const partial = !!options.partial;
  const data: {
    revision?: string;
    issuedAt?: Date | null;
    fileMode?: ManualFileMode;
    isLatest?: boolean;
    status?: string | null;
    tocJson?: ManualTocItem[];
    remark?: string | null;
  } = {};

  if (!partial || input.revision !== undefined) data.revision = requiredText(input.revision, '版本', 80, errors);
  if (!partial || input.issuedAt !== undefined) data.issuedAt = optionalDate(input.issuedAt, errors);
  if (!partial || input.fileMode !== undefined) {
    const fileMode = String(input.fileMode ?? '').trim().toUpperCase();
    if (!MANUAL_FILE_MODES.includes(fileMode as ManualFileMode)) errors.push('文件类型必须是 PDF 或图片集');
    else data.fileMode = fileMode as ManualFileMode;
  }
  if (!partial || input.isLatest !== undefined) data.isLatest = input.isLatest === true || String(input.isLatest).toLowerCase() === 'true';
  if (!partial || input.status !== undefined) data.status = optionalText(input.status, 80);
  if (!partial || input.remark !== undefined) data.remark = optionalText(input.remark, 1200);
  if (!partial || input.tocJson !== undefined) {
    const toc = parseManualToc(input.tocJson, options.pageCount);
    if (toc.error) errors.push(toc.error);
    else data.tocJson = toc.items;
  }
  return { data, errors };
}

export function manualObjectKey(manualId: string, versionId: string, filename: string): string {
  return `connector-assembly-manuals/${manualId}/${versionId}/${crypto.randomUUID()}-${safeFilename(filename)}`;
}

export function validateManualAsset(file: File, fileMode: ManualFileMode): string | null {
  const lowerName = file.name.toLowerCase();
  if (file.size <= 0) return `${file.name} 是空文件`;
  if (fileMode === 'PDF') {
    if (file.type !== MANUAL_PDF_MIME && !lowerName.endsWith('.pdf')) return 'PDF 版本只能上传 PDF 文件';
    if (file.size > MANUAL_PDF_MAX_BYTES) return 'PDF 文件不能超过 100MB';
    return null;
  }
  const isImageName = /\.(jpe?g|png|webp)$/i.test(lowerName);
  if (!MANUAL_IMAGE_MIMES.has(file.type) && !isImageName) return `${file.name} 不是支持的图片格式`;
  if (file.size > MANUAL_IMAGE_MAX_BYTES) return `${file.name} 超过单张图片 20MB 限制`;
  return null;
}

export async function inspectPdf(buffer: Buffer): Promise<{ pageCount: number; searchText: string }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const relativeWorker = path.join('node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs');
  const workerCandidates = [
    path.resolve(process.cwd(), relativeWorker),
    path.resolve(process.cwd(), '..', '..', relativeWorker),
    path.resolve(process.cwd(), '..', '..', '..', relativeWorker),
  ];
  const workerPath = workerCandidates.find(candidate => existsSync(candidate));
  if (!workerPath) throw new Error('PDF.js worker file is missing');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useWorkerFetch: false });
  const document = await loadingTask.promise;
  const pages: string[] = [];
  try {
    for (let pageNo = 1; pageNo <= document.numPages; pageNo += 1) {
      const page = await document.getPage(pageNo);
      const content = await page.getTextContent();
      const pageText = content.items
        .map(item => ('str' in item ? item.str : ''))
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (pageText) pages.push(`[第${pageNo}页] ${pageText}`);
      if (pages.join('\n').length >= 500_000) break;
    }
    return { pageCount: document.numPages, searchText: pages.join('\n').slice(0, 500_000) };
  } finally {
    await document.destroy();
  }
}

export function serializeManualAsset(asset: ConnectorAssemblyManualAsset) {
  return {
    id: asset.id,
    versionId: asset.versionId,
    assetType: asset.assetType,
    originalName: asset.originalName,
    displayName: asset.displayName,
    mimeType: asset.mimeType,
    size: asset.size,
    relativePath: asset.relativePath,
    fileHash: asset.fileHash,
    pageNo: asset.pageNo,
    sortOrder: asset.sortOrder,
    isPrimary: asset.isPrimary,
    uploadedBy: asset.uploadedBy,
    deletedAt: asset.deletedAt?.toISOString() || null,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
    contentUrl: `/api/connector-assembly-manual-assets/${asset.id}/content`,
    downloadUrl: `/api/connector-assembly-manual-assets/${asset.id}/download`,
  };
}

export function serializeManualVersion(version: ConnectorAssemblyManualVersion & { assets?: ConnectorAssemblyManualAsset[] }) {
  const toc = parseManualToc(version.tocJson, version.pageCount).items;
  return {
    id: version.id,
    manualId: version.manualId,
    revision: version.revision,
    issuedAt: version.issuedAt?.toISOString() || null,
    pageCount: version.pageCount,
    fileMode: version.fileMode as ManualFileMode,
    isLatest: version.isLatest,
    status: version.status,
    tocJson: toc,
    detectedTitle: version.detectedTitle,
    parseStatus: version.parseStatus,
    parseWarnings: Array.isArray(version.parseWarnings) ? version.parseWarnings.map(value => String(value)) : [],
    remark: version.remark,
    createdBy: version.createdBy,
    deletedAt: version.deletedAt?.toISOString() || null,
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString(),
    assets: (version.assets || []).map(serializeManualAsset),
  };
}

export function serializeManual(manual: ManualWithRelations) {
  const versions = (manual.versions || []).map(serializeManualVersion);
  const latestVersion = versions.find(version => version.isLatest && !version.deletedAt) || versions.find(version => !version.deletedAt) || null;
  const bindings = manual.bindings || [];
  const models = bindings
    .map(binding => binding.connectorParameter.model?.trim() || '')
    .filter(Boolean);
  return {
    id: manual.id,
    title: manual.title,
    manufacturer: manual.manufacturer,
    family: manual.family,
    documentNo: manual.documentNo,
    summary: manual.summary,
    keywords: manual.keywords,
    createdBy: manual.createdBy,
    deletedAt: manual.deletedAt?.toISOString() || null,
    createdAt: manual.createdAt.toISOString(),
    updatedAt: manual.updatedAt.toISOString(),
    versions,
    latestVersion,
    models,
    versionCount: versions.filter(version => !version.deletedAt).length,
    bindingCount: bindings.length,
    bindings: bindings.map(binding => ({
      id: binding.connectorParameter.id,
      model: binding.connectorParameter.model,
      rowNo: binding.connectorParameter.rowNo,
      remark: binding.connectorParameter.remark,
    })),
  };
}
