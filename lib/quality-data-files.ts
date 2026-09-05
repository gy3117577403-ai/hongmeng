import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { getObjectStream, putObject, deleteObjectsBestEffort } from '@/lib/s3';
import { safeFilename, validateFileSignature } from '@/lib/validation';
import { readQualityImageGeometry } from '@/lib/quality-image-metadata';
import { QualityDataError, assertQualityEdit, assertQualitySubmission, type QualityFormData, type QualityActor } from '@/lib/quality-data';
import { lockQuality, qualityInclude, qualityRevisionReset, snapshotQuality, serializeQuality } from '@/lib/quality-data-service';

const MIME: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel',
};
export const QUALITY_FILE_MAX = 20 * 1024 * 1024;
export function qualityFileType(name: string, size: number, bytes: Uint8Array) {
  const extension = name.split('.').pop()?.toLowerCase() || '';
  if (!MIME[extension]) throw new QualityDataError('支持 PDF、JPG、PNG、WEBP、XLSX、XLS 文件');
  if (!size || size > QUALITY_FILE_MAX || size !== bytes.byteLength) throw new QualityDataError('文件须为 1 字节至 20 MB', 413);
  if (extension === 'xlsx') {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || !Buffer.from(bytes).includes(Buffer.from('xl/workbook.xml'))) throw new QualityDataError('Excel 文件内容与扩展名不匹配');
  } else if (extension === 'xls') {
    if (!Buffer.from(bytes.subarray(0,8)).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]))) throw new QualityDataError('XLS 文件头无效');
  } else {
    const error = validateFileSignature(extension === 'jpeg' ? 'jpg' : extension as 'jpg' | 'png' | 'pdf' | 'webp', bytes);
    if (error) throw new QualityDataError(error);
  }
  return MIME[extension];
}
export async function uploadQualityFile(recordId: string, actor: QualityActor, form: FormData) {
  const upload = form.get('file'), version = Number(form.get('version'));
  const reason = String(form.get('reason') || '').trim().slice(0,1000);
  if (!(upload instanceof File)) throw new QualityDataError('请选择文件');
  if (upload.size > QUALITY_FILE_MAX) throw new QualityDataError('单个文件不能超过 20 MB', 413);
  const before = await prisma.qualityDataRecord.findUnique({ where: { id: recordId } });
  if (!before) throw new QualityDataError('质量记录不存在', 404);
  assertQualityEdit(actor, before);
  if (before.status === 'SUBMITTED' && !reason) throw new QualityDataError('补充已提交记录的附件须填写原因');
  const bytes = Buffer.from(await upload.arrayBuffer());
  const mimeType = qualityFileType(upload.name, upload.size, bytes);
  if (mimeType.startsWith('image/')) {
    try { await readQualityImageGeometry(bytes); } catch { throw new QualityDataError('图片无法解析或尺寸过大'); }
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const originalName = upload.name.slice(0,240);
  const existing = await prisma.qualityDataAttachment.findUnique({ where: { recordId_sha256_originalName: { recordId, sha256, originalName } } });
  if (existing && !existing.deletedAt) {
    const record = await prisma.qualityDataRecord.findUniqueOrThrow({ where: { id: recordId }, include: qualityInclude });
    return serializeQuality(record);
  }
  let key = '', committed = false;
  try {
    key = 'quality-data/' + recordId + '/' + randomUUID() + '-' + safeFilename(originalName);
    await putObject({ key, body: bytes, contentType: mimeType, originalName });
    const result = await prisma.$transaction(async tx => {
      const current = await lockQuality(tx, recordId, version);
      assertQualityEdit(actor, current);
      if (current.status === 'SUBMITTED' && !reason) throw new QualityDataError('请填写附件变更原因');
      if (current.attachments.filter(file => !file.deletedAt).length >= 30) throw new QualityDataError('每份记录最多 30 个有效附件');
      // A re-upload of a removed file restores the original bytes; immutable revisions keep the old membership.
      const prior = await tx.qualityDataAttachment.findUnique({ where: { recordId_sha256_originalName: { recordId, sha256, originalName } } });
      if (prior) await tx.qualityDataAttachment.update({ where: { id: prior.id }, data: { deletedAt: null } });
      else await tx.qualityDataAttachment.create({ data: { recordId, originalName, mimeType, size: bytes.length, objectKey: key, sha256, createdById: actor.id } });
      await tx.qualityDataRecord.update({ where: { id: recordId }, data: { version: { increment: 1 }, updatedById: actor.id, searchText: current.searchText + ' ' + originalName, ...qualityRevisionReset() } });
      return { record: await snapshotQuality(tx, recordId, actor, 'ATTACH', reason || '上传附件：' + originalName), keptNewObject: !prior };
    });
    committed = result.keptNewObject;
    return result.record;
  } finally {
    if (key && !committed) await deleteObjectsBestEffort([key]);
  }
}
export async function deleteQualityFile(fileId: string, actor: QualityActor, body: Record<string, unknown>) {
  const file = await prisma.qualityDataAttachment.findUnique({ where: { id: fileId } });
  if (!file) throw new QualityDataError('附件不存在', 404);
  const reason = String(body.reason || '').trim().slice(0,1000);
  if (!reason) throw new QualityDataError('请填写移除附件原因');
  return prisma.$transaction(async tx => {
    const current = await lockQuality(tx, file.recordId, body.version);
    assertQualityEdit(actor, current);
    const selected = current.attachments.find(item => item.id === fileId && !item.deletedAt);
    if (!selected) throw new QualityDataError('附件已移除', 409);
    if (current.status === 'SUBMITTED') {
      try { assertQualitySubmission(current.data as unknown as QualityFormData, current.attachments.filter(item => !item.deletedAt).length - 1); }
      catch { throw new QualityDataError('记录须保留有效检验内容或至少一份附件', 409); }
    }
    await tx.qualityDataAttachment.update({ where: { id: fileId }, data: { deletedAt: new Date() } });
    await tx.qualityDataRecord.update({ where: { id: current.id }, data: { version: { increment: 1 }, updatedById: actor.id, ...qualityRevisionReset() } });
    return snapshotQuality(tx, current.id, actor, 'REMOVE_ATTACHMENT', reason);
  });
}
export async function qualityFileContent(fileId: string, historyVersion: string | null) {
  const file = await prisma.qualityDataAttachment.findUnique({ where: { id: fileId }, include: { record: { select: { id: true, deletedAt: true } } } });
  if (!file) throw new QualityDataError('附件不存在', 404);
  if (file.deletedAt || file.record.deletedAt) {
    const version = Number(historyVersion);
    const revision = Number.isInteger(version) && version > 0
      ? await prisma.qualityDataRevision.findUnique({ where: { recordId_version: { recordId: file.recordId, version } } }) : null;
    const snap = revision?.snapshot as { attachments?: Array<{ id: string; deletedAt: unknown }> } | undefined;
    if (!snap?.attachments?.some(item => item.id === fileId && !item.deletedAt)) throw new QualityDataError('附件已移除；请从对应历史版本查看', 404);
  }
  return { file, stream: await getObjectStream(file.objectKey) };
}
