import { createHash } from 'node:crypto';
import { Prisma, type SampleTask } from '@prisma/client';
import { SamplePlanError } from './sample-plan-domain';

export type SampleDocument = { id: string; name: string; kind: string; version: string; mimeType: string; size: number; createdAt: string };
type Tx = Prisma.TransactionClient;
export function sampleDocuments(value: unknown): SampleDocument[] {
  if (!Array.isArray(value)) return [];
  return value.filter((f): f is SampleDocument => !!f && typeof f === 'object' && typeof f.id === 'string' && ['drawing','sop'].includes(f.kind));
}
export const documentJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function currentSampleDocuments(tx: Tx, task: Pick<SampleTask, 'id' | 'drawingLibraryItemId' | 'documentSnapshot' | 'approvedPackageId'>) {
  if (task.documentSnapshot !== null) return sampleDocuments(task.documentSnapshot);
  // Compatibility for old writers; once initialized, orders never follow archive changes implicitly.
  const pack = task.approvedPackageId ? await tx.qfPackage.findUnique({ where: { id: task.approvedPackageId } }) : null;
  const ids = pack ? [...(pack.drawingFiles as {id:string}[]), ...(pack.sopFiles as {id:string}[])].map(f=>f.id) : null;
  const files = await tx.drawingLibraryFile.findMany({ where: { libraryItemId: task.drawingLibraryItemId,
    ...(ids ? { id: { in: ids } } : { isCurrent: true, deletedAt: null }), category: { code: { in: ['drawing','sop'] } } },
    include: { category: { select: { code: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  return files.map(f => ({ id: f.id, name: f.displayName || f.originalName, kind: f.category.code, version: f.version, mimeType: f.mimeType, size: f.size, createdAt: f.createdAt.toISOString() }));
}
export async function initializeSampleDocuments(tx: Tx, id: string) {
  const task = await tx.sampleTask.findUniqueOrThrow({ where: { id } });
  const files = await currentSampleDocuments(tx, task);
  if (task.documentSnapshot === null || task.documentReviewRequired) await tx.sampleTask.update({ where: { id }, data: { documentSnapshot: documentJson(files), documentReviewRequired: false } });
  return files;
}

export async function isSampleDocumentReferenced(tx: Tx, fileId: string) {
  const filter = { array_contains: [{id:fileId}] };
  const [task, completion, event] = await Promise.all([
    tx.sampleTask.findFirst({where:{documentSnapshot:filter},select:{id:true}}),
    tx.sampleCompletion.findFirst({where:{documentSnapshot:filter},select:{id:true}}),
    tx.operationLog.findFirst({where:{action:'sample_document_changed',OR:[{detail:{path:['old','id'],equals:fileId}},{detail:{path:['next','id'],equals:fileId}}]},select:{id:true}}),
  ]);
  return !!(task || completion || event);
}
export type SampleDocumentUpload = { taskId: string; expectedVersion: number; mutationId: string; replaceFileId: string; kind: 'drawing'|'sop'; reason: string; materialChanged: boolean; productionAcknowledged?: boolean; name: string; mimeType: string; size: number; objectKey: string; sha256: string; actor: { id: string; name: string } };
export async function saveSampleDocument(tx: Tx, input: SampleDocumentUpload) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-task:${input.taskId}`}))`;
  const task = await tx.sampleTask.findFirst({ where: { id: input.taskId, deletedAt: null } });
  if (!task) throw new SamplePlanError('样品订单不存在或已删除', 404);
  const hash = createHash('sha256').update(JSON.stringify([input.replaceFileId,input.kind,input.reason,input.materialChanged,input.name,input.sha256])).digest('hex');
  const prior = await tx.operationLog.findFirst({ where: { action: 'sample_document_changed', targetId: task.id, detail: { path: ['mutationId'], equals: input.mutationId } } });
  if (prior) {
    const data = prior.detail as {requestHash:string;fileId:string};
    if (data.requestHash !== hash) throw new SamplePlanError('同一次替换内容已变化，请重新打开窗口',409);
    return { fileId: data.fileId, replayed: true };
  }
  if (task.version !== input.expectedVersion) throw new SamplePlanError('订单已更新，请重新打开替换窗口',409);
  if (task.status === 'CANCELLED') throw new SamplePlanError('已取消订单仅保留图纸查看',409);
  if (task.status !== 'PLANNED' && !input.reason) throw new SamplePlanError('制作中或已完成订单必须填写更换说明');
  if (['IN_PROGRESS','SUBMITTED'].includes(task.status) && input.productionAcknowledged !== true) throw new SamplePlanError('请确认已通知现场切换图纸');
  if (task.status === 'COMPLETED' && input.materialChanged) throw new SamplePlanError('已完成订单只更正资料，不重新配料');
  const files = await currentSampleDocuments(tx, task);
  const old = files.find(f=>f.id === input.replaceFileId);
  if (input.replaceFileId && (!old || old.kind !== input.kind)) throw new SamplePlanError('待替换文件已变化，请重新选择',409);
  const category = await tx.resourceCategory.findUnique({ where: { code: input.kind } });
  if (!category) throw new SamplePlanError('图纸分类未初始化',409);
  if (!await tx.drawingLibraryItem.findFirst({where:{id:task.drawingLibraryItemId,deletedAt:null}})) throw new SamplePlanError('产品档案已删除',409);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`drawing-library:${task.drawingLibraryItemId}:${category.id}`}))`;
  const versions = await tx.drawingLibraryFile.findMany({where:{libraryItemId:task.drawingLibraryItemId,categoryId:category.id},select:{version:true}});
  const revision = 1 + versions.reduce((n,f)=>Math.max(n, Number(f.version.match(/^V1\.(\d+)$/i)?.[1] ?? -1)), -1);
  const file = await tx.drawingLibraryFile.create({ data: { libraryItemId: task.drawingLibraryItemId, categoryId: category.id,
    originalName: input.name, displayName: input.name, mimeType: input.mimeType, size: input.size, objectKey: input.objectKey, sha256: input.sha256,
    version: `V1.${revision}`, sourceType: 'SAMPLE_ORDER_DOCUMENT', sourceEntityId: task.id, uploadedById: input.actor.id,
    isCurrent: false, remark: `样品订单 ${task.code} 专用版本；${input.reason || '补充图纸'}` } });
  const next: SampleDocument = { id:file.id,name:input.name,kind:input.kind,version:file.version,mimeType:file.mimeType,size:file.size,createdAt:file.createdAt.toISOString() };
  const snapshot = old ? files.map(f=>f.id===old.id?next:f) : [...files,next];
  const changed = await tx.sampleTask.updateMany({ where:{id:task.id,version:input.expectedVersion,deletedAt:null},data:{documentSnapshot:documentJson(snapshot),documentReviewRequired:false,version:{increment:1},updatedById:input.actor.id,updatedByName:input.actor.name} });
  if (changed.count !== 1) throw new SamplePlanError('订单已变化，本次替换未保存',409);
  if (input.materialChanged) {
    const warehouse = await tx.warehouseMaterialTask.findUnique({where:{sampleTaskId:task.id}});
    if (warehouse) {
      const status = warehouse.status === 'completed' ? 'pending' : warehouse.status;
      const updated = await tx.warehouseMaterialTask.updateMany({where:{id:warehouse.id,version:warehouse.version},data:{requirementsConfirmed:false,status,completedAt:null,completedById:null,version:{increment:1},updatedById:input.actor.id}});
      if (updated.count !== 1) throw new SamplePlanError('仓库配料状态已更新，请重新确认物料变化后保存',409);
      await tx.warehouseMaterialActivity.create({data:{taskId:warehouse.id,action:'sample_drawing_changed',actorId:input.actor.id,fromStatus:warehouse.status,toStatus:status,content:`图纸更换为 ${file.version}，涉及物料变化，请复核配料。${input.reason}`}});
    }
  }
  await tx.operationLog.create({data:{userId:input.actor.id,action:'sample_document_changed',targetType:'sample_task',targetId:task.id,detail:documentJson({mutationId:input.mutationId,requestHash:hash,fileId:file.id,actorName:input.actor.name,reason:input.reason,materialChanged:input.materialChanged,scope:'ORDER_ONLY',old:old || null,next,before:files,after:snapshot,completedCorrection:task.status==='COMPLETED'})}});
  return {fileId:file.id,replayed:false};
}
