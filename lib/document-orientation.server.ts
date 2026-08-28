import { PDFDocument, degrees } from 'pdf-lib';
import sharp from 'sharp';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';
import { readPrintableSourceStream, PrintableDocumentError } from '@/lib/printable-document';
import { canSaveDocumentOrientation } from '@/lib/document-orientation-access';
import { parsePageRotations, type PageRotations } from '@/lib/document-orientation';
import { normalizePreviewRotation } from '@/lib/preview-gestures';
import { fileType } from '@/lib/validation';
import { canAccessApiRoute } from '@/lib/api-route-access';

type Kind = 'drawing' | 'resource';
class DisplaySettingsError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'DOCUMENT_ORIENTATION_INVALID') { super(message); }
}

async function sourceFile(kind: Kind, id: string) {
  if (kind === 'drawing') {
    const file = await prisma.drawingLibraryFile.findFirst({ where: { id, deletedAt: null, libraryItem: { deletedAt: null } } });
    if (!file) throw new DisplaySettingsError('文件不存在或已删除', 404);
    return { ...file, fileType: fileType(file.originalName, file.mimeType), drawingOwned: true, fileName: file.displayName || file.originalName };
  }
  const file = await prisma.resourceFile.findFirst({ where: { id, deletedAt: null, status: 'uploaded', workOrder: { deletedAt: null } } });
  if (!file) throw new DisplaySettingsError('文件不存在或已删除', 404);
  // Even a hidden/deleted library link retains ownership; a broader work-order grant must not bypass it.
  const linked = await prisma.drawingLibraryFile.findFirst({ where: { OR: [{ sourceResourceFileId: id }, { objectKey: file.objectKey }] }, select: { id: true } });
  return { ...file, drawingOwned: !!linked, size: file.fileSize, fileName: file.displayName || file.originalName };
}

async function sourceBytes(file: Awaited<ReturnType<typeof sourceFile>>) {
  if (file.size > 50 * 1024 * 1024) throw new DisplaySettingsError('文件超过 50MB，无法处理方向', 413);
  return readPrintableSourceStream(await getObjectStream(file.objectKey), { fileName: file.fileName, maxBytes: 50 * 1024 * 1024 });
}

export async function exportOrientedDocument(bytes: Uint8Array, mimeType: string, rotations: PageRotations) {
  if (mimeType === 'application/pdf' || Buffer.from(bytes.subarray(0, 5)).toString() === '%PDF-') {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const valid = parsePageRotations(rotations, doc.getPageCount());
    doc.getPages().forEach((page, i) => page.setRotation(degrees(normalizePreviewRotation(page.getRotation().angle + (valid[i + 1] || 0)))));
    return { bytes: Buffer.from(await doc.save()), mimeType: 'application/pdf', extension: 'pdf' };
  }
  const valid = parsePageRotations(rotations, 1);
  // Apply EXIF exactly once before the user's additional rotation; retain the original object unchanged.
  const oriented = await sharp(bytes, { limitInputPixels: 60_000_000 }).autoOrient().png().toBuffer();
  return { bytes: await sharp(oriented).rotate(valid[1] || 0).png().toBuffer(), mimeType: 'image/png', extension: 'png' };
}

export async function documentDisplaySettings(req: NextRequest, kind: Kind, id: string) {
  try {
    const user = await requireUser();
    const file = await sourceFile(kind, id);
    if (file.fileType !== 'pdf' && !file.mimeType.startsWith('image/')) throw new DisplaySettingsError('此文件不支持方向设置');
    const canSave = canAccessApiRoute(user.access, req.nextUrl.pathname, 'PATCH') === true && canSaveDocumentOrientation(user.access, file.drawingOwned);
    const current = await prisma.documentDisplaySetting.findUnique({ where: { objectKey: file.objectKey } });
    if (req.method === 'GET') {
      if (req.nextUrl.searchParams.get('download') === '1') {
        const exported = await exportOrientedDocument(await sourceBytes(file), file.mimeType, parsePageRotations(current?.pageRotations || {}));
        const filename = `${file.fileName.replace(/\.[^.]+$/, '')}-已保存方向.${exported.extension}`;
        return new Response(exported.bytes, { headers: {
          'Content-Type': exported.mimeType, 'Content-Length': String(exported.bytes.length),
          'Content-Disposition': `attachment; filename="oriented-document.${exported.extension}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
          'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Document-Display-Revision': String(current?.revision || 0),
        } });
      }
      return NextResponse.json({ ok: true, revision: current?.revision || 0, pageRotations: current?.pageRotations || {}, canSave, updatedAt: current?.updatedAt || null }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    if (!canSave) throw new DisplaySettingsError('当前账号只能临时旋转，不能修改公共默认方向', 403, 'DOCUMENT_ORIENTATION_FORBIDDEN');
    const input = await req.json();
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DisplaySettingsError('方向设置格式无效');
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw new DisplaySettingsError('方向版本无效');
    parsePageRotations(input.pageRotations);
    const count = file.fileType === 'pdf' ? (await PDFDocument.load(await sourceBytes(file), { updateMetadata: false })).getPageCount() : 1;
    const rotations = parsePageRotations(input.pageRotations, count);
    const saved = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`document-display:${file.objectKey}`}))`;
      const previous = await tx.documentDisplaySetting.findUnique({ where: { objectKey: file.objectKey } });
      if ((previous?.revision || 0) !== input.revision) throw new DisplaySettingsError('方向已被其他人修改，请先恢复服务器已保存方向再重新调整', 409, 'DOCUMENT_ORIENTATION_CONFLICT');
      const active = kind === 'drawing'
        ? await tx.drawingLibraryFile.findFirst({ where: { id, objectKey: file.objectKey, deletedAt: null, libraryItem: { deletedAt: null } }, select: { id: true } })
        : await tx.resourceFile.findFirst({ where: { id, objectKey: file.objectKey, deletedAt: null, status: 'uploaded', workOrder: { deletedAt: null } }, select: { id: true } });
      if (!active) throw new DisplaySettingsError('文件已变更或删除，请刷新后重试', 409);
      const data = { pageCount: count, pageRotations: rotations, revision: (previous?.revision || 0) + 1, updatedById: user.id };
      const setting = await tx.documentDisplaySetting.upsert({ where: { objectKey: file.objectKey }, create: { objectKey: file.objectKey, ...data }, update: data });
      await tx.operationLog.create({ data: { userId: user.id, action: 'save_document_orientation', targetType: kind === 'drawing' ? 'drawing_library_file' : 'resource_file', targetId: id, detail: { before: previous?.pageRotations || {}, after: rotations, revision: setting.revision, pageCount: count } } });
      return setting;
    });
    return NextResponse.json({ ok: true, revision: saved.revision, pageRotations: saved.pageRotations, updatedAt: saved.updatedAt, canSave });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof DisplaySettingsError || error instanceof PrintableDocumentError) return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    if (error instanceof SyntaxError || (error instanceof Error && /页面方向|旋转角度|文件页数/.test(error.message))) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    console.error('document display settings failed', error);
    return NextResponse.json({ ok: false, error: '文件方向处理失败，请确认文件可读取后重试' }, { status: 500 });
  }
}
