import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';
import type { PdfOverlayAnnotation, PdfOverlayDocument } from '@/components/sop/pdf-overlay-editor-types';
import { PDF_OVERLAY_SCHEMA_VERSION } from '@/components/sop/pdf-overlay-editor-types';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';

export const PDF_OVERLAY_MAX_JSON_BYTES = 5 * 1024 * 1024;
export const PDF_OVERLAY_MAX_ANNOTATIONS = 5_000;
export const PDF_OVERLAY_MAX_ASSET_BYTES = 12 * 1024 * 1024;

export class PdfOverlayRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: unknown;

  constructor(message: string, status = 400, code = 'PDF_OVERLAY_INVALID_REQUEST', detail?: unknown) {
    super(message);
    this.name = 'PdfOverlayRequestError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export function pdfOverlayRouteError(error: unknown, fallback = 'PDF 在线编辑失败') {
  if (error instanceof PdfOverlayRequestError) {
    return Response.json({ ok: false, error: error.message, code: error.code, detail: error.detail }, { status: error.status });
  }
  console.error('[pdf-overlay]', error);
  return Response.json({ ok: false, error: fallback, code: 'PDF_OVERLAY_INTERNAL_ERROR' }, { status: 500 });
}

export async function streamToBuffer(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function sha256(body: Buffer) {
  return crypto.createHash('sha256').update(body).digest('hex');
}

function finite(value: unknown, field: string, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new PdfOverlayRequestError(`${field}格式无效`);
  }
  return value;
}

function cleanAnnotation(input: unknown, pageCount: number, index: number): PdfOverlayAnnotation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PdfOverlayRequestError(`第 ${index + 1} 条批注格式无效`);
  const value = input as Record<string, unknown>;
  const kinds = new Set(['text', 'image', 'rectangle', 'arrow', 'pen', 'highlight', 'cover']);
  if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{6,160}$/.test(value.id)) throw new PdfOverlayRequestError('批注标识无效');
  if (typeof value.kind !== 'string' || !kinds.has(value.kind)) throw new PdfOverlayRequestError('批注类型无效');
  if (typeof value.page !== 'number' || !Number.isInteger(value.page) || value.page < 1 || value.page > pageCount) {
    throw new PdfOverlayRequestError('批注页码无效');
  }
  if (!value.style || typeof value.style !== 'object' || Array.isArray(value.style)) throw new PdfOverlayRequestError('批注样式无效');
  const style = value.style as Record<string, unknown>;
  const points = Array.isArray(value.points)
    ? value.points.slice(0, 20_000).map(point => {
      if (!point || typeof point !== 'object' || Array.isArray(point)) throw new PdfOverlayRequestError('画笔轨迹无效');
      const p = point as Record<string, unknown>;
      return { x: finite(p.x, '轨迹横坐标', -1, 2), y: finite(p.y, '轨迹纵坐标', -1, 2) };
    })
    : undefined;
  const imageAssetId = typeof value.imageAssetId === 'string' && /^[A-Za-z0-9_-]{6,160}$/.test(value.imageAssetId) ? value.imageAssetId : undefined;
  const imageSrc = typeof value.imageSrc === 'string' && value.imageSrc.startsWith('/api/drawing-library/sop-pdf-overlay-assets/') ? value.imageSrc : undefined;
  if (value.kind === 'image' && (!imageAssetId || !imageSrc)) throw new PdfOverlayRequestError('插入图片已失效，请重新上传');
  return {
    id: value.id,
    page: value.page,
    kind: value.kind as PdfOverlayAnnotation['kind'],
    x: finite(value.x, '横坐标', -1, 2),
    y: finite(value.y, '纵坐标', -1, 2),
    width: finite(value.width, '批注宽度', 0, 3),
    height: finite(value.height, '批注高度', 0, 3),
    endX: value.endX === undefined ? undefined : finite(value.endX, '终点横坐标', -1, 2),
    endY: value.endY === undefined ? undefined : finite(value.endY, '终点纵坐标', -1, 2),
    points,
    text: typeof value.text === 'string' ? value.text.slice(0, 20_000) : undefined,
    imageAssetId,
    imageSrc,
    style: {
      stroke: typeof style.stroke === 'string' ? style.stroke.slice(0, 32) : '#ef6c00',
      fill: typeof style.fill === 'string' ? style.fill.slice(0, 32) : 'transparent',
      textColor: typeof style.textColor === 'string' ? style.textColor.slice(0, 32) : '#172033',
      opacity: finite(style.opacity, '透明度', 0, 1),
      strokeWidth: finite(style.strokeWidth, '线宽', 0.25, 40),
      fontSize: finite(style.fontSize, '字号', 6, 240),
    },
    zIndex: typeof value.zIndex === 'number' && Number.isInteger(value.zIndex) ? value.zIndex : index,
    hidden: value.hidden === true,
    locked: value.locked === true,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
  };
}

export function validatePdfOverlayDocument(input: unknown, identity: { itemId: string; fileId: string; pageCount: number }): PdfOverlayDocument {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PdfOverlayRequestError('编辑草稿格式无效');
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > PDF_OVERLAY_MAX_JSON_BYTES) throw new PdfOverlayRequestError('编辑草稿不能超过 5MB');
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== PDF_OVERLAY_SCHEMA_VERSION) throw new PdfOverlayRequestError('不支持的编辑草稿版本');
  if (value.sourceId !== identity.itemId || value.baseFileId !== identity.fileId) {
    throw new PdfOverlayRequestError('草稿与当前产品或 PDF 版本不匹配，请刷新后重试', 409, 'PDF_OVERLAY_IDENTITY_CONFLICT');
  }
  if (value.pageCount !== identity.pageCount) throw new PdfOverlayRequestError('PDF 页数已变化，请刷新后重新编辑', 409, 'PDF_OVERLAY_SOURCE_CHANGED');
  if (!Array.isArray(value.annotations) || value.annotations.length > PDF_OVERLAY_MAX_ANNOTATIONS) {
    throw new PdfOverlayRequestError(`单个版本最多允许 ${PDF_OVERLAY_MAX_ANNOTATIONS} 条批注`);
  }
  return {
    schemaVersion: PDF_OVERLAY_SCHEMA_VERSION,
    sourceId: identity.itemId,
    baseFileId: identity.fileId,
    sourceFileName: typeof value.sourceFileName === 'string' ? value.sourceFileName.slice(0, 500) : 'SOP.pdf',
    pageCount: identity.pageCount,
    annotations: value.annotations.map((annotation, index) => cleanAnnotation(annotation, identity.pageCount, index)),
    revision: typeof value.revision === 'number' && Number.isInteger(value.revision) ? value.revision : 0,
    updatedAt: new Date().toISOString(),
  };
}

export async function loadEditablePdfSource(itemId: string, fileId: string) {
  const file = await prisma.drawingLibraryFile.findFirst({
    where: { id: fileId, libraryItemId: itemId, deletedAt: null, isCurrent: true, libraryItem: { deletedAt: null }, category: { code: 'sop' } },
    include: { category: { select: { id: true, name: true, code: true, sortOrder: true } }, uploadedBy: { select: { displayName: true, username: true } } },
  });
  if (!file) throw new PdfOverlayRequestError('当前 SOP PDF 不存在、已删除或不是最新版本', 404, 'PDF_OVERLAY_SOURCE_NOT_FOUND');
  if (file.mimeType !== 'application/pdf' && !/\.pdf$/i.test(file.originalName)) throw new PdfOverlayRequestError('在线二次编辑仅支持 PDF 文件');
  const body = await streamToBuffer(await getObjectStream(file.objectKey));
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(body, { ignoreEncryption: false, updateMetadata: false });
  } catch {
    throw new PdfOverlayRequestError('当前 PDF 已加密或损坏，无法在线编辑');
  }
  const pageCount = pdf.getPageCount();
  if (!pageCount) throw new PdfOverlayRequestError('当前 PDF 没有可编辑页面');
  return { file, body, pageCount, hash: sha256(body) };
}

export function emptyPdfOverlayDocument(input: { itemId: string; fileId: string; fileName: string; pageCount: number }): PdfOverlayDocument {
  return { schemaVersion: PDF_OVERLAY_SCHEMA_VERSION, sourceId: input.itemId, baseFileId: input.fileId, sourceFileName: input.fileName, pageCount: input.pageCount, annotations: [], revision: 0, updatedAt: new Date().toISOString() };
}

export async function lockPdfOverlayScope(tx: Prisma.TransactionClient, documentId: string) {
  await tx.$queryRaw`SELECT id FROM "pdf_overlay_documents" WHERE id = ${documentId} FOR UPDATE`;
}
