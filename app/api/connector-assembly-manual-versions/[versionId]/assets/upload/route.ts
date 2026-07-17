import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  inspectPdf,
  MANUAL_IMAGE_MAX_COUNT,
  manualObjectKey,
  serializeManualAsset,
  validateManualAsset,
} from '@/lib/connector-assembly-manuals';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { deleteObjectsBestEffort, putObject } from '@/lib/s3';
import { fileType, validateFileSignature } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function imageMime(file: File): string {
  if (file.type) return file.type;
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

type PreparedAsset = {
  file: File;
  body: Buffer;
  mimeType: string;
  objectKey: string;
  fileHash: string;
};

export async function POST(req: NextRequest, { params }: { params: { versionId: string } }) {
  try {
    const user = await requireUser();
    const version = await prisma.connectorAssemblyManualVersion.findFirst({
      where: { id: params.versionId, deletedAt: null, manual: { deletedAt: null } },
      include: { manual: true, assets: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
    });
    if (!version) return NextResponse.json({ ok: false, error: '说明书版本不存在或已删除' }, { status: 404 });
    const form = await req.formData();
    const candidates = [...form.getAll('files'), form.get('file')].filter((value): value is File => value instanceof File);
    const files = Array.from(new Map(candidates.map(file => [`${file.name}:${file.size}:${file.lastModified}`, file])).values());
    if (!files.length) return NextResponse.json({ ok: false, error: '请选择 PDF 或图片文件' }, { status: 400 });
    if (version.fileMode === 'PDF' && files.length !== 1) return NextResponse.json({ ok: false, error: 'PDF 版本每次只能上传一个 PDF' }, { status: 400 });
    if (version.fileMode === 'PDF' && version.assets.some(asset => asset.assetType === 'PDF')) return NextResponse.json({ ok: false, error: '当前版本已有 PDF，请新建版本后上传' }, { status: 409 });
    if (version.fileMode === 'IMAGE_SET' && version.assets.length + files.length > MANUAL_IMAGE_MAX_COUNT) return NextResponse.json({ ok: false, error: `图片集最多 ${MANUAL_IMAGE_MAX_COUNT} 张` }, { status: 400 });
    for (const file of files) {
      const error = validateManualAsset(file, version.fileMode as 'PDF' | 'IMAGE_SET');
      if (error) return NextResponse.json({ ok: false, error }, { status: 400 });
    }

    const prepared: PreparedAsset[] = [];
    let pdfInfo: { pageCount: number; searchText: string } | null = null;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const body = Buffer.from(await file.arrayBuffer());
      const mimeType = version.fileMode === 'PDF' ? 'application/pdf' : imageMime(file);
      const type = fileType(file.name, mimeType);
      if (type === 'unknown') return NextResponse.json({ ok: false, error: `${file.name} 不是支持的文件格式` }, { status: 400 });
      const signatureError = validateFileSignature(type, body);
      if (signatureError) return NextResponse.json({ ok: false, error: `${file.name}：${signatureError}` }, { status: 400 });
      if (version.fileMode === 'PDF') {
        try {
          pdfInfo = await inspectPdf(body);
        } catch (error) {
          console.error('manual PDF inspect failed', error);
          return NextResponse.json({ ok: false, error: 'PDF 文件无法解析，请确认文件完整且未加密' }, { status: 400 });
        }
      }
      const objectKey = manualObjectKey(version.manualId, version.id, file.name);
      prepared.push({ file, body, mimeType, objectKey, fileHash: createHash('sha256').update(body).digest('hex') });
    }

    const uploadedKeys: string[] = [];
    try {
      for (const asset of prepared) {
        await putObject({ key: asset.objectKey, body: asset.body, contentType: asset.mimeType, originalName: asset.file.name });
        uploadedKeys.push(asset.objectKey);
      }
    } catch (error) {
      await deleteObjectsBestEffort(uploadedKeys);
      throw error;
    }

    const userName = user.displayName || user.username;
    let created;
    try {
      created = await prisma.$transaction(async tx => {
        const assets = [];
        for (let index = 0; index < prepared.length; index += 1) {
          const asset = prepared[index];
          assets.push(await tx.connectorAssemblyManualAsset.create({
            data: {
              versionId: version.id,
              assetType: version.fileMode === 'PDF' ? 'PDF' : 'IMAGE',
              originalName: asset.file.name,
              mimeType: asset.mimeType,
              size: asset.file.size,
              objectKey: asset.objectKey,
              relativePath: asset.file.name,
              fileHash: asset.fileHash,
              pageNo: version.fileMode === 'PDF' ? null : version.assets.length + index + 1,
              sortOrder: version.assets.length + index,
              isPrimary: version.assets.length === 0 && index === 0,
              uploadedBy: userName,
            },
          }));
        }
        if (pdfInfo) {
          await tx.connectorAssemblyManualVersion.update({ where: { id: version.id }, data: { pageCount: pdfInfo.pageCount, searchText: pdfInfo.searchText || null, parseStatus: pdfInfo.searchText ? 'parsed' : 'partial' } });
        } else {
          await tx.connectorAssemblyManualVersion.update({ where: { id: version.id }, data: { pageCount: version.assets.length + assets.length } });
        }
        await tx.connectorAssemblyManual.update({ where: { id: version.manualId }, data: { updatedAt: new Date() } });
        return assets;
      });
    } catch (error) {
      await deleteObjectsBestEffort(uploadedKeys);
      throw error;
    }
    await logOp({
      userId: user.id,
      action: 'upload_connector_assembly_manual_version',
      targetType: 'connector_assembly_manual_version',
      targetId: version.id,
      detail: { manualId: version.manualId, revision: version.revision, fileMode: version.fileMode, fileCount: created.length, pageCount: pdfInfo?.pageCount || version.assets.length + created.length },
    });
    return NextResponse.json({ ok: true, assets: created.map(serializeManualAsset), pageCount: pdfInfo?.pageCount || version.assets.length + created.length });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '说明书文件上传失败，请检查对象存储配置' }, { status: 500 });
  }
}
