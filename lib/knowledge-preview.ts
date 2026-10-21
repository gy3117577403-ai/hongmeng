import crypto from 'node:crypto';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getObjectStream, putObject, deleteObjectsBestEffort } from '@/lib/s3';
import { isExcelFile, isOfficeFile, OFFICE_RENDERER_VERSION, type PreviewSheet, type SheetMetadata, type OfficePreviewStatus } from '@/lib/knowledge-preview-types';

type StoredSheet = SheetMetadata & { objectKey: string };
export class KnowledgePreviewError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const activeAttachment = { deletedAt: null, article: { deletedAt: null } } as const;
const sourceLimit = 50 * 1024 * 1024;
const resultLimit = 80 * 1024 * 1024;

export async function queueKnowledgePreviews(tx: Prisma.TransactionClient, files: { id: string; objectKey: string; fileType: string }[]) {
  const data = files.filter(file => isOfficeFile(file.fileType)).map(file => ({ attachmentId: file.id, sourceObjectKey: file.objectKey,
    rendererVersion: OFFICE_RENDERER_VERSION, tableStatus: isExcelFile(file.fileType) ? 'pending' : 'unavailable' }));
  if (data.length) await tx.knowledgeAttachmentPreview.createMany({ data, skipDuplicates: true });
}

export async function ensureKnowledgePreview(attachmentId: string, retry = false) {
  return prisma.$transaction(async tx => {
    // Serialize initial lazy generation and retries without changing the article version.
    await tx.$queryRaw`SELECT id FROM knowledge_attachments WHERE id = ${attachmentId} FOR UPDATE`;
    const attachment = await tx.knowledgeAttachment.findFirst({ where: { id: attachmentId, ...activeAttachment } });
    if (!attachment) throw new KnowledgePreviewError('附件不存在或已删除', 404);
    if (!isOfficeFile(attachment.fileType)) throw new KnowledgePreviewError('该文件使用原有图片或 PDF 预览');
    const current = await tx.knowledgeAttachmentPreview.findUnique({ where: { attachmentId } });
    if (!current) {
      await queueKnowledgePreviews(tx, [attachment]);
    } else if (current.sourceObjectKey !== attachment.objectKey || current.rendererVersion !== OFFICE_RENDERER_VERSION) {
      await tx.knowledgeAttachmentPreview.update({ where: { attachmentId }, data: { sourceObjectKey: attachment.objectKey,
        rendererVersion: OFFICE_RENDERER_VERSION, status: 'pending', tableStatus: isExcelFile(attachment.fileType) ? 'pending' : 'unavailable',
        pdfStatus: 'pending', sheets: [], pdfKey: null, tableError: null, pdfError: null, attempts: 0, leaseToken: null, leaseUntil: null } });
    } else if (retry && ['ready', 'failed'].includes(current.status) && (current.pdfStatus === 'failed' || current.tableStatus === 'failed')) {
      await tx.knowledgeAttachmentPreview.update({ where: { attachmentId }, data: { status: 'pending', attempts: 0,
        ...(current.pdfStatus === 'failed' ? { pdfStatus: 'pending', pdfError: null } : {}),
        ...(current.tableStatus === 'failed' ? { tableStatus: 'pending', tableError: null } : {}) } });
    }
    return tx.knowledgeAttachmentPreview.findUniqueOrThrow({ where: { attachmentId } });
  });
}

export function serializeOfficePreview(preview: Awaited<ReturnType<typeof ensureKnowledgePreview>>): OfficePreviewStatus {
  const sheets = preview.sheets as unknown as StoredSheet[];
  return { status: preview.status as OfficePreviewStatus['status'], tableStatus: preview.tableStatus as OfficePreviewStatus['tableStatus'],
    pdfStatus: preview.pdfStatus as OfficePreviewStatus['pdfStatus'], tableError: preview.tableError, pdfError: preview.pdfError,
    sheets: sheets.map(({ objectKey: _key, ...metadata }) => metadata),
    pdfUrl: preview.pdfStatus === 'ready' ? `/api/knowledge/attachments/${preview.attachmentId}/preview/pdf` : null };
}

export async function readableKnowledgePreview(attachmentId: string) {
  const preview = await prisma.knowledgeAttachmentPreview.findFirst({ where: { attachmentId, rendererVersion: OFFICE_RENDERER_VERSION,
    attachment: activeAttachment }, include: { attachment: true } });
  if (!preview || preview.sourceObjectKey !== preview.attachment.objectKey) throw new KnowledgePreviewError('预览不存在或原文件已更新，请重新打开', 404);
  return preview;
}

export async function readPreviewObject(key: string, limit = resultLimit): Promise<Buffer> {
  const stream = await getObjectStream(key, { abortSignal: AbortSignal.timeout(30000) });
  const chunks: Buffer[] = []; let length = 0;
  try {
    for await (const chunk of stream) {
      length += chunk.length;
      if (length > limit) throw new KnowledgePreviewError('文件超出在线预览大小限制，请下载原件查看');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } finally { stream.destroy(); }
}

async function parseInWorker(bytes: Buffer): Promise<PreviewSheet[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(process.env.KNOWLEDGE_PREVIEW_WORKER_DIR || path.resolve(process.cwd(), process.cwd().endsWith('standalone') ? '../../ops' : 'ops'), 'knowledge-sheet-worker.cjs'),
      { workerData: bytes, resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 } });
    let finished = false;
    const done = (error?: Error, sheets?: PreviewSheet[]) => {
      if (finished) return; finished = true; clearTimeout(timer); void worker.terminate();
      if (error) reject(error); else resolve(sheets!);
    };
    const timer = setTimeout(() => done(new Error('表格解析超时，请使用版式预览或下载原件。')), 30000);
    worker.once('message', message => done(message.error ? new Error(message.error) : undefined, message.sheets));
    worker.once('error', () => done(new Error('表格解析失败或超出内存限制，请使用版式预览或下载原件。')));
    worker.once('exit', code => { if (!finished) done(new Error(`表格解析未完成（${code}），请重试。`)); });
  });
}

async function convertPdf(bytes: Buffer, extension: string) {
  const endpoint = process.env.OFFICE_PREVIEW_URL;
  if (!endpoint) throw new Error('预览转换服务尚未配置，请联系管理员配置 OFFICE_PREVIEW_URL 后重试。');
  const form = new FormData();
  form.append('files', new Blob([new Uint8Array(bytes)]), `document.${extension}`);
  // Keep original print areas and hidden sheets. Do not enable singlePageSheets.
  form.append('updateIndexes', 'false');
  const response = await fetch(`${endpoint.replace(/\/$/, '')}/forms/libreoffice/convert`, { method: 'POST', body: form, signal: AbortSignal.timeout(75000), redirect: 'error' });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(response.status === 400 ? '文件可能已加密、损坏或格式不受支持，请检查原件后重试。' : '转换服务暂时繁忙或不可用，请稍后重试。');
  }
  if (!response.body) throw new Error('转换服务未返回文件，请重试。');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break;
      length += value.length; if (length > resultLimit) throw new Error('生成的预览超过 80 MB，请下载原件查看。'); chunks.push(value); }
  } finally { await reader.cancel().catch(() => undefined); }
  const pdf = Buffer.concat(chunks);
  if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('转换服务未生成有效 PDF，请重试。');
  return pdf;
}

export async function processKnowledgePreview() {
  // Only one document per worker call; independent replicas safely claim different rows.
  const job = await prisma.$transaction(async tx => {
    const interrupted = await tx.knowledgeAttachmentPreview.findMany({ where: { status: 'processing', leaseUntil: { lt: new Date() }, attempts: { gte: 3 } } });
    for (const row of interrupted) await tx.knowledgeAttachmentPreview.updateMany({ where: { attachmentId: row.attachmentId, leaseToken: row.leaseToken, leaseUntil: { lt: new Date() } }, data: {
      status: row.tableStatus === 'ready' || row.pdfStatus === 'ready' ? 'ready' : 'failed', leaseToken: null, leaseUntil: null,
      ...(row.tableStatus === 'pending' ? { tableStatus: 'failed', tableError: '预览任务多次中断，请重试。' } : {}),
      ...(row.pdfStatus === 'pending' ? { pdfStatus: 'failed', pdfError: '预览任务多次中断，请重试。' } : {}),
    } });
    const candidates = await tx.$queryRaw<{ attachment_id: string }[]>`
      SELECT p.attachment_id FROM knowledge_attachment_previews p
      JOIN knowledge_attachments a ON a.id = p.attachment_id
      JOIN knowledge_articles k ON k.id = a.article_id
      WHERE a.deleted_at IS NULL AND k.deleted_at IS NULL AND p.renderer_version = ${OFFICE_RENDERER_VERSION}
      AND (p.status = 'pending' OR (p.status = 'processing' AND p.lease_until < NOW() AND p.attempts < 3))
      ORDER BY p.updated_at LIMIT 1 FOR UPDATE OF p SKIP LOCKED`;
    if (!candidates.length) return null;
    return tx.knowledgeAttachmentPreview.update({ where: { attachmentId: candidates[0].attachment_id },
      data: { status: 'processing', attempts: { increment: 1 }, leaseToken: crypto.randomUUID(), leaseUntil: new Date(Date.now() + 180000) }, include: { attachment: true } });
  });
  if (!job) return { processed: false };
  const keys: string[] = [];
  const prefix = `knowledge-previews/${job.attachmentId}/${job.leaseToken}`;
  const guard = { attachmentId: job.attachmentId, leaseToken: job.leaseToken, sourceObjectKey: job.sourceObjectKey, rendererVersion: OFFICE_RENDERER_VERSION,
    attachment: { ...activeAttachment, objectKey: job.sourceObjectKey } };
  let tableStatus = job.tableStatus, pdfStatus = job.pdfStatus;
  let tableError = job.tableError, pdfError = job.pdfError;
  try {
    if (job.attachment.size > sourceLimit) throw new Error('文件超过 50 MB，暂不支持在线预览，请下载原件查看。');
    const bytes = await readPreviewObject(job.sourceObjectKey, sourceLimit);
    if (isExcelFile(job.attachment.fileType) && tableStatus !== 'ready') {
      try {
        const sheets = await parseInWorker(bytes); const manifest: StoredSheet[] = [];
        for (let i = 0; i < sheets.length; i++) {
          const { rows: _rows, merges: _merges, ...metadata } = sheets[i];
          const objectKey = `${prefix}/sheet-${i}.json`; keys.push(objectKey);
          await putObject({ key: objectKey, body: Buffer.from(JSON.stringify(sheets[i])), contentType: 'application/json', originalName: `${i}.json` });
          manifest.push({ ...metadata, objectKey });
        }
        const saved = await prisma.knowledgeAttachmentPreview.updateMany({ where: guard, data: { sheets: manifest, tableStatus: 'ready', tableError: null } });
        if (!saved.count) { await deleteObjectsBestEffort(keys); return { processed: true, discarded: true }; }
        tableStatus = 'ready'; tableError = null;
      } catch (error) { tableStatus = 'failed'; tableError = safePreviewError(error, '表格解析失败，请尝试版式预览或下载原件。'); }
    }
    if (pdfStatus !== 'ready') {
      try {
        const bytesPdf = await convertPdf(bytes, job.attachment.fileType);
        const pdfKey = `${prefix}/document.pdf`; keys.push(pdfKey);
        await putObject({ key: pdfKey, body: bytesPdf, contentType: 'application/pdf', originalName: 'preview.pdf' });
        const saved = await prisma.knowledgeAttachmentPreview.updateMany({ where: guard, data: { pdfKey, pdfStatus: 'ready', pdfError: null } });
        if (!saved.count) { await deleteObjectsBestEffort(keys); return { processed: true, discarded: true }; }
        pdfStatus = 'ready'; pdfError = null;
      } catch (error) { pdfStatus = 'failed'; pdfError = safePreviewError(error, '转换失败或超时，请稍后重试。'); }
    }
  } catch (error) {
    const message = safePreviewError(error, '原文件读取失败，请稍后重试。');
    if (tableStatus === 'pending') { tableStatus = 'failed'; tableError = message; }
    if (pdfStatus === 'pending') { pdfStatus = 'failed'; pdfError = message; }
  }
  const saved = await prisma.knowledgeAttachmentPreview.updateMany({ where: guard, data: {
    status: tableStatus === 'ready' || pdfStatus === 'ready' ? 'ready' : 'failed', tableStatus, pdfStatus, tableError, pdfError, leaseToken: null, leaseUntil: null,
  } });
  if (!saved.count) await deleteObjectsBestEffort(keys);
  return { processed: true, attachmentId: job.attachmentId, tableStatus, pdfStatus };
}

function safePreviewError(error: unknown, fallback: string) {
  // Do not expose storage endpoints, credentials, converter internals or arbitrary parser errors.
  return error instanceof Error && /^[\u3400-\u9fff〔]/.test(error.message) ? error.message.slice(0, 250) : fallback;
}

export async function readKnowledgePreviewSheet(attachmentId: string, index: number) {
  const preview = await readableKnowledgePreview(attachmentId);
  const sheets = preview.sheets as unknown as StoredSheet[];
  if (preview.tableStatus !== 'ready' || !Number.isInteger(index) || index < 0 || !sheets[index]) throw new KnowledgePreviewError('工作表尚未生成或不存在', 404);
  return JSON.parse((await readPreviewObject(sheets[index].objectKey, 64 * 1024 * 1024)).toString('utf8')) as PreviewSheet;
}
