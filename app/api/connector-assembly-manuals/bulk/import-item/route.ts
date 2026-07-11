import type { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  bulkSearchText,
  parseBulkManualCandidate,
  refreshManualImportBatch,
  serializeManualImportItem,
} from '@/lib/connector-manual-bulk-import';
import { inspectPdf, manualObjectKey, validateManualAsset } from '@/lib/connector-assembly-manuals';
import { isGenericConnectorManualManufacturer, sanitizeConnectorManualManufacturer } from '@/lib/connector-manual-parser';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { putObject } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

class ImportItemError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type UploadedAsset = {
  file: File;
  body: Buffer;
  hash: string;
  objectKey: string;
  mimeType: string;
  relativePath: string;
};

function record(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function textList(value: unknown, max = 100): string[] {
  return Array.isArray(value) ? Array.from(new Set(value.map(item => String(item ?? '').trim()).filter(Boolean))).slice(0, max) : [];
}

function dateValue(value: unknown): Date | null {
  const raw = text(value, 40);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function mimeType(file: File, fileMode: 'PDF' | 'IMAGE_SET'): string {
  if (fileMode === 'PDF') return 'application/pdf';
  if (file.type) return file.type;
  if (file.name.toLowerCase().endsWith('.png')) return 'image/png';
  if (file.name.toLowerCase().endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function sha256(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

async function failItem(itemId: string, batchId: string, message: string): Promise<void> {
  await prisma.connectorAssemblyManualImportItem.updateMany({
    where: { id: itemId, status: { in: ['pending', 'processing'] } },
    data: { status: 'failed', errorMessage: message.slice(0, 1000) },
  }).catch(() => undefined);
  await refreshManualImportBatch(batchId).catch(() => undefined);
}

export async function POST(req: NextRequest) {
  let itemId = '';
  let batchId = '';
  try {
    const user = await requireUser();
    const form = await req.formData();
    if (String(form.get('confirmText') || '').trim() !== 'IMPORT_MANUALS') throw new ImportItemError('缺少 IMPORT_MANUALS 导入确认词');
    batchId = String(form.get('batchId') || '').trim();
    const clientId = String(form.get('clientId') || '').trim();
    if (!batchId || !clientId) throw new ImportItemError('缺少 batchId 或 clientId');
    const item = await prisma.connectorAssemblyManualImportItem.findUnique({
      where: { batchId_clientId: { batchId, clientId } },
      include: { batch: true },
    });
    if (!item) throw new ImportItemError('批次导入项不存在', 404);
    itemId = item.id;
    if (item.status === 'success' || item.status === 'duplicate') return NextResponse.json({ ok: true, idempotent: true, item: serializeManualImportItem(item) });
    if (item.status === 'processing') throw new ImportItemError('该文件正在上传，请勿重复提交', 409);
    if (!['pending', 'failed'].includes(item.status)) throw new ImportItemError('该导入项当前不可上传', 409);
    const claimed = await prisma.connectorAssemblyManualImportItem.updateMany({
      where: { id: item.id, status: { in: ['pending', 'failed'] } },
      data: { status: 'processing', errorMessage: null, attemptCount: { increment: 1 } },
    });
    if (claimed.count !== 1) throw new ImportItemError('该文件状态已变化，请刷新批次', 409);
    const metadata = record(item.metadataJson);
    const parsed = parseBulkManualCandidate(metadata);
    if (parsed.errors.length) throw new ImportItemError(parsed.errors.join('；'));
    const candidate = parsed.candidate;
    const files = form.getAll('files').filter((value): value is File => value instanceof File);
    if (files.length !== candidate.assets.length) throw new ImportItemError('上传文件数量与预览不一致，请重新预览');
    const prepared: Array<{ file: File; body: Buffer; hash: string; mimeType: string; relativePath: string }> = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const validationError = validateManualAsset(file, candidate.fileMode);
      if (validationError) throw new ImportItemError(validationError);
      const body = Buffer.from(await file.arrayBuffer());
      const hash = sha256(body);
      const expected = candidate.assets[index];
      if (hash !== expected.hash || file.size !== expected.size) throw new ImportItemError(`${file.name} 与预览时文件不一致，请重新预览`);
      prepared.push({ file, body, hash, mimeType: mimeType(file, candidate.fileMode), relativePath: expected.relativePath || candidate.relativePath });
    }
    const existingHashCount = await prisma.connectorAssemblyManualAsset.count({
      where: { fileHash: { in: prepared.map(asset => asset.hash) }, deletedAt: null, version: { deletedAt: null, manual: { deletedAt: null } } },
    });
    if (existingHashCount >= prepared.length) {
      const duplicateItem = await prisma.connectorAssemblyManualImportItem.update({
        where: { id: item.id },
        data: { status: 'duplicate', errorMessage: null },
      });
      await refreshManualImportBatch(batchId);
      return NextResponse.json({ ok: true, duplicate: true, item: serializeManualImportItem(duplicateItem) });
    }
    const title = text(metadata.defaultTitle, 240) || candidate.defaultTitle;
    const revision = text(metadata.suggestedRevision, 80) || item.revision || candidate.revisionCandidate || '待识别';
    const rawManufacturer = text(metadata.manufacturerCandidate, 160);
    const manufacturer = sanitizeConnectorManualManufacturer(rawManufacturer) || null;
    const family = text(metadata.familyCandidate, 160) || null;
    const detectedTitle = text(metadata.detectedTitle, 240) || null;
    const keywords = textList(metadata.keywordCandidates, 40);
    const modelCandidates = textList(metadata.modelCandidates, 24);
    const warnings = textList(metadata.warnings, 100);
    if (isGenericConnectorManualManufacturer(rawManufacturer)) warnings.unshift(`制造商候选“${rawManufacturer}”可信度不足，已保持为空`);
    const chapters = Array.isArray(metadata.chapterCandidates) ? metadata.chapterCandidates as Array<{ title?: unknown; pageStart?: unknown; pageEnd?: unknown }> : [];
    const targetManualId = text(metadata.matchedManualId, 100);
    const autoBindUnique = metadata.autoBindUnique !== false;
    const selectedParameterIds = textList(metadata.selectedParameterIds, 500);
    const uniqueParameterIds = textList(metadata.uniqueParameterIds, 500);
    const bindingIds = Array.from(new Set(selectedParameterIds.length ? selectedParameterIds : autoBindUnique ? uniqueParameterIds : []));
    if (bindingIds.length) {
      const count = await prisma.connectorParameter.count({ where: { id: { in: bindingIds }, deletedAt: null } });
      if (count !== bindingIds.length) throw new ImportItemError('部分建议关联参数已不存在，请重新预览');
    }
    let manualId = targetManualId;
    let manual = manualId ? await prisma.connectorAssemblyManual.findFirst({ where: { id: manualId, deletedAt: null } }) : null;
    if (!manual && item.action === 'create_version') manual = await prisma.connectorAssemblyManual.findFirst({ where: { title: { equals: title, mode: 'insensitive' }, deletedAt: null }, orderBy: { updatedAt: 'desc' } });
    if (item.action === 'create_version' && !manual) throw new ImportItemError('目标说明书尚未创建，请等待同名首份完成后重试', 409);
    if (item.action === 'create_manual') {
      const appeared = await prisma.connectorAssemblyManual.findFirst({ where: { title: { equals: title, mode: 'insensitive' }, deletedAt: null } });
      if (appeared) throw new ImportItemError('同名说明书已出现，请重新预览并改为新增版本', 409);
      manualId = randomUUID();
    } else {
      manualId = manual?.id || '';
    }
    const revisionExists = manualId ? await prisma.connectorAssemblyManualVersion.findFirst({ where: { manualId, revision: { equals: revision, mode: 'insensitive' } } }) : null;
    if (revisionExists) throw new ImportItemError(`版本 ${revision} 已存在，请修改版本号后重试`, 409);
    const versionId = randomUUID();
    const uploadedAssets: UploadedAsset[] = [];
    for (const asset of prepared) {
      const objectKey = manualObjectKey(manualId, versionId, asset.file.name);
      await putObject({ key: objectKey, body: asset.body, contentType: asset.mimeType, originalName: asset.file.name });
      uploadedAssets.push({ ...asset, objectKey });
    }
    let pageCount = candidate.fileMode === 'IMAGE_SET' ? uploadedAssets.length : candidate.pageCount;
    let pdfText = '';
    let parseStatus = candidate.parseFailed ? 'partial' : 'parsed';
    if (candidate.fileMode === 'PDF') {
      try {
        const inspected = await inspectPdf(uploadedAssets[0].body);
        pageCount = inspected.pageCount;
        pdfText = inspected.searchText;
      } catch {
        parseStatus = 'failed';
        warnings.unshift('服务端 PDF 正文提取失败，文件已保留，可按文件名搜索');
      }
    }
    const tocJson = chapters.map(item => ({
      title: text(item.title, 160),
      pageStart: Number(item.pageStart || 0),
      pageEnd: Number(item.pageEnd || item.pageStart || 0),
    })).filter(item => item.title && Number.isInteger(item.pageStart) && Number.isInteger(item.pageEnd) && item.pageStart >= 1 && item.pageEnd >= item.pageStart && (!pageCount || item.pageEnd <= pageCount));
    if (!manufacturer || !candidate.revisionCandidate || !candidate.issuedAtCandidate || !bindingIds.length || !keywords.length) parseStatus = parseStatus === 'failed' ? 'failed' : 'partial';
    const searchText = bulkSearchText({
      fileNames: uploadedAssets.map(asset => asset.file.name),
      title,
      detectedTitle: detectedTitle || undefined,
      relativePaths: uploadedAssets.map(asset => asset.relativePath),
      manufacturer: manufacturer || undefined,
      family: family || undefined,
      revision,
      models: modelCandidates,
      keywords,
      chapters: tocJson,
      pdfText,
    });
    const userName = user.displayName || user.username;
    const result = await prisma.$transaction(async tx => {
      if (item.action === 'create_manual') {
        await tx.connectorAssemblyManual.create({
          data: { id: manualId, title, manufacturer, family, keywords: keywords.join('、') || null, createdBy: userName },
        });
      } else if (manual) {
        await tx.connectorAssemblyManual.update({
          where: { id: manual.id },
          data: {
            manufacturer: manual.manufacturer || manufacturer,
            family: manual.family || family,
            keywords: manual.keywords || keywords.join('、') || null,
          },
        });
      }
      await tx.connectorAssemblyManualVersion.updateMany({ where: { manualId, deletedAt: null }, data: { isLatest: false } });
      await tx.connectorAssemblyManualVersion.create({
        data: {
          id: versionId,
          manualId,
          revision,
          issuedAt: dateValue(metadata.issuedAtCandidate),
          pageCount: pageCount || null,
          fileMode: candidate.fileMode,
          isLatest: true,
          status: parseStatus === 'parsed' ? '有效' : '待完善',
          tocJson: tocJson as Prisma.InputJsonValue,
          searchText,
          detectedTitle,
          parseStatus,
          parseWarnings: warnings as Prisma.InputJsonValue,
          createdBy: userName,
        },
      });
      await tx.connectorAssemblyManualAsset.createMany({
        data: uploadedAssets.map((asset, index) => ({
          versionId,
          assetType: candidate.fileMode === 'PDF' ? 'PDF' : 'IMAGE',
          originalName: asset.file.name,
          mimeType: asset.mimeType,
          size: asset.file.size,
          objectKey: asset.objectKey,
          relativePath: asset.relativePath || null,
          fileHash: asset.hash,
          pageNo: candidate.fileMode === 'PDF' ? null : index + 1,
          sortOrder: index,
          isPrimary: index === 0,
          uploadedBy: userName,
        })),
      });
      if (bindingIds.length) await tx.connectorAssemblyManualBinding.createMany({ data: bindingIds.map(connectorParameterId => ({ manualId, connectorParameterId })), skipDuplicates: true });
      return tx.connectorAssemblyManualImportItem.update({
        where: { id: item.id },
        data: {
          status: 'success',
          errorMessage: null,
          manualId,
          versionId,
          pageCount: pageCount || null,
          detectedTitle,
          warningsJson: warnings as Prisma.InputJsonValue,
        },
      });
    });
    await refreshManualImportBatch(batchId);
    await logOp({
      userId: user.id,
      action: 'bulk_import_connector_assembly_manual',
      targetType: 'connector_assembly_manual',
      targetId: manualId,
      detail: { batchId, itemId: item.id, action: item.action, revision, fileCount: uploadedAssets.length, pageCount, parseStatus, bindingCount: bindingIds.length },
    });
    await logOp({ userId: user.id, action: 'upload_connector_assembly_manual_version', targetType: 'connector_assembly_manual_version', targetId: versionId, detail: { manualId, revision, source: 'bulk_import', batchId, fileCount: uploadedAssets.length } });
    if (bindingIds.length) await logOp({ userId: user.id, action: 'bind_connector_assembly_manual', targetType: 'connector_assembly_manual', targetId: manualId, detail: { count: bindingIds.length, source: 'bulk_import', batchId } });
    return NextResponse.json({ ok: true, item: serializeManualImportItem(result), manualId, versionId, parseStatus });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const message = error instanceof ImportItemError ? error.message : '说明书文件导入失败，请检查文件或对象存储';
    if (itemId && batchId) await failItem(itemId, batchId, message);
    if (!(error instanceof ImportItemError)) console.error(error);
    return NextResponse.json({ ok: false, error: message }, { status: error instanceof ImportItemError ? error.status : 500 });
  }
}
