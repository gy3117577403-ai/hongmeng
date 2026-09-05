import { createHash, randomUUID } from 'node:crypto';
import { prisma } from './prisma';
import { getObjectStream, putObject, deleteObjectsBestEffort } from './s3';
import { safeFilename } from './validation';
import { readQualityImageGeometry } from './quality-image-metadata';
import { QualityDataError, qualityText, type QualityActor } from './quality-data';
import { qualityFileType, QUALITY_FILE_MAX } from './quality-data-files';
import { assertReferenceEdit, lockReference, referenceInclude, referenceSnapshot, serializeReference } from './quality-reference-service';

export async function uploadReferenceFile(referenceId: string, actor: QualityActor, form: FormData) {
  const upload = form.get('file'), version = Number(form.get('version')), reason = qualityText(form.get('reason'),1000);
  if (!(upload instanceof File)) throw new QualityDataError('请选择文件');
  if (upload.size > QUALITY_FILE_MAX) throw new QualityDataError('单个文件不能超过 20 MB',413);
  const before = await prisma.qualityReference.findUnique({ where: { id: referenceId } });
  if (!before) throw new QualityDataError('参考方案不存在',404);
  assertReferenceEdit(actor,before);
  if (before.status !== 'DRAFT' && !reason) throw new QualityDataError('请填写附件变更说明');
  const bytes = Buffer.from(await upload.arrayBuffer()), mimeType = qualityFileType(upload.name,upload.size,bytes);
  if (mimeType.startsWith('image/')) {
    try { await readQualityImageGeometry(bytes); } catch { throw new QualityDataError('图片无法解析或尺寸过大'); }
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex'), originalName = upload.name.slice(0,240);
  const existing = await prisma.qualityReferenceAttachment.findUnique({ where: { referenceId_sha256_originalName: { referenceId,sha256,originalName } } });
  if (existing && !existing.deletedAt) return serializeReference(await prisma.qualityReference.findUniqueOrThrow({ where: { id: referenceId }, include: referenceInclude }));
  let key = '', committed = false;
  try {
    key = 'quality-references/' + referenceId + '/' + randomUUID() + '-' + safeFilename(originalName);
    await putObject({ key,body:bytes,contentType:mimeType,originalName });
    const result = await prisma.$transaction(async tx => {
      const current = await lockReference(tx,referenceId,version);
      assertReferenceEdit(actor,current);
      if (current.status !== 'DRAFT' && !reason) throw new QualityDataError('请填写附件变更说明');
      if (current.attachments.filter(f=>!f.deletedAt).length >= 30) throw new QualityDataError('每套方案最多 30 个附件');
      const prior = await tx.qualityReferenceAttachment.findUnique({ where: { referenceId_sha256_originalName: { referenceId,sha256,originalName } } });
      if (prior) await tx.qualityReferenceAttachment.update({ where: { id: prior.id }, data: { deletedAt:null } });
      else await tx.qualityReferenceAttachment.create({ data: { referenceId,originalName,mimeType,size:bytes.length,objectKey:key,sha256,createdById:actor.id } });
      await tx.qualityReference.update({ where: { id: referenceId }, data: { version:{increment:1},updatedById:actor.id,searchText:current.searchText+' '+originalName } });
      return { record:await referenceSnapshot(tx,referenceId,actor,'ATTACH',reason||'上传附件：'+originalName),keep:!prior };
    });
    committed = result.keep; return result.record;
  } finally { if(key&&!committed) await deleteObjectsBestEffort([key]); }
}
export async function deleteReferenceFile(fileId: string, actor: QualityActor, body: Record<string,unknown>) {
  const file = await prisma.qualityReferenceAttachment.findUnique({where:{id:fileId}}),reason=qualityText(body.reason,1000);
  if(!file)throw new QualityDataError('附件不存在',404);
  if(!reason)throw new QualityDataError('请填写移除原因');
  return prisma.$transaction(async tx=>{
    const current=await lockReference(tx,file.referenceId,body.version);assertReferenceEdit(actor,current);
    if(!current.attachments.some(f=>f.id===fileId&&!f.deletedAt))throw new QualityDataError('附件已移除',409);
    await tx.qualityReferenceAttachment.update({where:{id:fileId},data:{deletedAt:new Date()}});
    await tx.qualityReference.update({where:{id:current.id},data:{version:{increment:1},updatedById:actor.id}});
    return referenceSnapshot(tx,current.id,actor,'REMOVE_ATTACHMENT',reason);
  });
}
export async function referenceFileContent(fileId: string, historyVersion: string|null) {
  const file=await prisma.qualityReferenceAttachment.findUnique({where:{id:fileId},include:{reference:{select:{deletedAt:true}}}});
  if(!file)throw new QualityDataError('附件不存在',404);
  if(file.deletedAt||file.reference.deletedAt){
    const version=Number(historyVersion);
    const revision=Number.isInteger(version)&&version>0?await prisma.qualityReferenceRevision.findUnique({where:{referenceId_version:{referenceId:file.referenceId,version}}}):null;
    const snapshot=revision?.snapshot as {attachments?:Array<{id:string;deletedAt:unknown}>}|undefined;
    if(!snapshot?.attachments?.some(f=>f.id===fileId&&!f.deletedAt))throw new QualityDataError('附件已移除，请从历史版本查看',404);
  }
  return {file,stream:await getObjectStream(file.objectKey)};
}
