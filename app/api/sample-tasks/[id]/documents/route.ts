import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ForbiddenError, UnauthorizedError, forbidden, requireUser, unauthorized } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { currentSampleDocuments, saveSampleDocument } from '@/lib/sample-documents';
import { SamplePlanError } from '@/lib/sample-plan-domain';
import { deleteObjectsBestEffort, putObject } from '@/lib/s3';
import { safeFilename, validateFileContent } from '@/lib/validation';
import { inspectMediaImage } from '@/lib/media-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function errorResponse(error: unknown) {
  if (error instanceof UnauthorizedError) return unauthorized(error);
  if (error instanceof ForbiddenError) return forbidden();
  if (error instanceof SamplePlanError) return NextResponse.json({ok:false,error:error.message},{status:error.status});
  console.error('sample documents failed', error);
  return NextResponse.json({ok:false,error:'图纸操作失败，请保留输入后重试'},{status:500});
}
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const result = await prisma.$transaction(async tx => {
      const task = await tx.sampleTask.findFirst({where:{id:params.id,deletedAt:null}});
      if (!task) throw new SamplePlanError('样品订单不存在或已删除',404);
      const files = await currentSampleDocuments(tx,task);
      const history = await tx.operationLog.findMany({where:{action:'sample_document_changed',targetId:task.id},orderBy:{createdAt:'desc'},take:50,select:{id:true,createdAt:true,detail:true}});
      return {task:{id:task.id,code:task.code,version:task.version,status:task.status,specification:task.specificationSnapshot},files,history};
    },{isolationLevel:'RepeatableRead'});
    return NextResponse.json({ok:true,...result},{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) { return errorResponse(error); }
}
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let key = '', committed = false;
  try {
    assertSameOriginMutationRequest(req);
    const actor = await requireUser();
    if (Number(req.headers.get('content-length') || 0) > 51*1024*1024) throw new SamplePlanError('文件不能超过 50 MB');
    const form = await req.formData(), file = form.get('file'), kind = String(form.get('kind') || 'drawing');
    const expectedVersion = Number(form.get('expectedVersion')), mutationId = String(form.get('mutationId') || '');
    if (!(file instanceof File) || !['drawing','sop'].includes(kind)) throw new SamplePlanError('请选择图纸或 SOP 文件');
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || !/^[\w-]{8,100}$/.test(mutationId)) throw new SamplePlanError('订单版本无效，请重新打开窗口');
    if (!file.size || file.size > 50*1024*1024) throw new SamplePlanError('请选择不超过 50 MB 的文件');
    if (!/\.(pdf|png|jpe?g|webp)$/i.test(file.name)) throw new SamplePlanError('支持 PDF、PNG、JPG、WebP');
    const body = Buffer.from(await file.arrayBuffer());
    const mime = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
    const error = validateFileContent(file.name,mime,file.size,body);
    if (error) throw new SamplePlanError(error);
    if (mime.startsWith('image/') && !await inspectMediaImage(body,mime)) throw new SamplePlanError('图片无效或像素过大');
    const name = file.name.replace(/[\r\n\x00]/g,'').slice(0,240);
    key = 'sample-documents/' + params.id + '/' + randomUUID() + '-' + safeFilename(name);
    await putObject({key,body,contentType:mime,originalName:name});
    const result = await prisma.$transaction(tx=>saveSampleDocument(tx,{
      taskId:params.id,expectedVersion,mutationId,kind:kind as 'drawing'|'sop',
      replaceFileId:String(form.get('replaceFileId') || ''),reason:String(form.get('reason') || '').trim().slice(0,1000),
      materialChanged:form.get('materialChanged')==='true',name,mimeType:mime,size:file.size,objectKey:key,
      productionAcknowledged:form.get('productionAcknowledged')==='true',
      sha256:createHash('sha256').update(body).digest('hex'),actor:{id:actor.id,name:actor.displayName || actor.username},
    }),{maxWait:20000,timeout:30000});
    committed = !result.replayed;
    if(result.replayed) { await deleteObjectsBestEffort([key]); key=''; }
    return NextResponse.json({ok:true,...result});
  } catch(error) {
    if (key && !committed) await deleteObjectsBestEffort([key]);
    return errorResponse(error);
  }
}
