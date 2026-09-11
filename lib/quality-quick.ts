import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { type QuickQualityDTO } from '@/lib/quality-quick-shared';

export class QuickQualityError extends Error { constructor(message: string, public status = 400) { super(message); } }
export type QuickActor = { id: string; name: string; admin: boolean; manage: boolean };
export const quickInclude = { orders: { include: { workOrder: { select: { id: true, code: true, businessCode: true, productName: true, specification: true, deletedAt: true, drawingLibraryItemId: true } } } }, product: true, photos: { orderBy: { createdAt: 'asc' as const } } } satisfies Prisma.QuickQualityRecordInclude;
type QuickRecord = Prisma.QuickQualityRecordGetPayload<{ include: typeof quickInclude }>;
export function quickScopeChanged(r: QuickRecord) { return r.scope === 'PRODUCT' && (!r.product || !!r.product.deletedAt); }
export function quickEffective(r: QuickRecord, now = new Date()) { return !r.deletedAt && r.state === 'ACTIVE' && (!r.effectiveUntil || r.effectiveUntil >= now) && !quickScopeChanged(r); }
export function quickDTO(r: QuickRecord): QuickQualityDTO {
  return { id:r.id, number:r.number, description:r.description, state:r.state as QuickQualityDTO['state'], scope:r.scope as QuickQualityDTO['scope'], version:r.version,
    createdAt:r.createdAt.toISOString(), updatedAt:r.updatedAt.toISOString(), occurredAt:r.occurredAt.toISOString(), author:r.createdByName, processName:r.processName,
    effectiveUntil:r.effectiveUntil?.toISOString() || null, deletedAt:r.deletedAt?.toISOString() || null, printPolicy:r.printPolicy, productId:r.productId,
    drawing:r.product?{id:r.product.id,customerName:r.product.customerName,productName:r.product.productName||'',specification:r.product.specification}:null, needsAssociation:!r.productId,
    productName:r.product ? [r.product.customerName,r.product.productName,r.product.specification].filter(Boolean).join(' · ') : '', scopeChanged:quickScopeChanged(r), escalatedReportId:r.escalatedReportId,
    orders:r.orders.map(({workOrder:o}) => ({ id:o.id, code:o.businessCode || o.code, productName:o.productName, specification:o.specification || '' })),
    photos:r.photos.filter(f=>!f.deletedAt).map(f=>({id:f.id,name:f.displayName,url:'/api/quality-quick/photos/'+f.id, imageWidth:f.imageWidth,imageHeight:f.imageHeight,mimeType:f.mimeType})) };
}
export async function quickDetail(id:string, history = false) {
  const r=await prisma.quickQualityRecord.findUnique({where:{id},include:quickInclude});
  if(!r) throw new QuickQualityError('快处记录不存在',404);
  const dto=quickDTO(r);
  if(history) dto.activities=(await prisma.quickQualityActivity.findMany({where:{recordId:id},orderBy:{version:'desc'}})).map(a=>({id:a.id,action:a.action,actor:a.actorName,reason:a.reason,createdAt:a.createdAt.toISOString(),version:a.version,snapshot:a.snapshot}));
  return dto;
}
export async function quickList(params:URLSearchParams) {
  const page=Math.max(1,Math.min(10000,Number(params.get('page'))||1)), size=25, q=(params.get('q')||'').trim().slice(0,200), state=params.get('state');
  const where:Prisma.QuickQualityRecordWhereInput={ deletedAt:params.get('trash')==='1'?{not:null}:null,
    ...(state && ['SAVED','ACTIVE','OFFLINE'].includes(state)?{state}:{}),
    ...(q?{OR:[{description:{contains:q,mode:'insensitive'}},{number:{contains:q,mode:'insensitive'}},{createdByName:{contains:q,mode:'insensitive'}},{product:{is:{OR:[{customerName:{contains:q,mode:'insensitive'}},{productName:{contains:q,mode:'insensitive'}},{specification:{contains:q,mode:'insensitive'}}]}}},{orders:{some:{workOrder:{OR:[{code:{contains:q,mode:'insensitive'}},{businessCode:{contains:q,mode:'insensitive'}},{productName:{contains:q,mode:'insensitive'}}]}}}}]}:{}) };
  const from=params.get('from'),to=params.get('to');
  if(from||to) where.occurredAt={...(from?{gte:quickDate(from,'开始日期')}:{}),...(to?{lte:quickDate(to,'结束日期',true)}:{})};
  if(from && to && from>to) throw new QuickQualityError('开始日期不能晚于结束日期');
  const [total,rows]=await prisma.$transaction([prisma.quickQualityRecord.count({where}),prisma.quickQualityRecord.findMany({where,include:quickInclude,orderBy:[{updatedAt:'desc'},{id:'desc'}],take:size,skip:(page-1)*size})]);
  return {rows:rows.map(quickDTO),page,pages:Math.max(1,Math.ceil(total/size)),total};
}
export async function quickSummary() {
  const [total, candidates]=await Promise.all([prisma.quickQualityRecord.count({where:{deletedAt:null}}),prisma.quickQualityRecord.findMany({where:{deletedAt:null,state:'ACTIVE'},include:quickInclude})]);
  const active=candidates.filter(r=>quickEffective(r));
  return { total, active:active.length, requiresReview:candidates.filter(quickScopeChanged).length };
}
export function quickDate(value:unknown,label:string,end=false) {
  const text=String(value||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new QuickQualityError(label+'格式不正确');
  const d=new Date(text+(end?'T23:59:59.999+08:00':'T00:00:00+08:00'));
  if(!Number.isFinite(d.getTime()) || new Date(d.getTime()+8*3600000).toISOString().slice(0,10)!==text) throw new QuickQualityError(label+'无效');
  return d;
}
export async function quickOrderOptions(q:string, ids:string[] = []) {
  return prisma.workOrder.findMany({where:{deletedAt:null,...(ids.length?{id:{in:ids}}:q?{OR:[{code:{contains:q,mode:'insensitive'}},{businessCode:{contains:q,mode:'insensitive'}},{productName:{contains:q,mode:'insensitive'}},{specification:{contains:q,mode:'insensitive'}}]}:{})},
    select:{id:true,code:true,businessCode:true,productName:true,specification:true,drawingLibraryItemId:true},take:30,orderBy:{updatedAt:'desc'}});
}
export async function quickDrawingOptions(q:string, productId?:string) {
  return prisma.drawingLibraryItem.findMany({where:{deletedAt:null,...(productId?{id:productId}:q?{OR:[{customerName:{contains:q,mode:'insensitive'}},{productName:{contains:q,mode:'insensitive'}},{specification:{contains:q,mode:'insensitive'}}]}:{})},
    select:{id:true,customerName:true,productName:true,specification:true},take:30,orderBy:[{updatedAt:'desc'},{id:'asc'}]});
}
export async function quickWarningsForOrders(ids:string[]) {
  const result=new Map<string,QuickQualityDTO[]>();
  if(!ids.length) return result;
  const orders=await prisma.workOrder.findMany({where:{id:{in:ids},deletedAt:null},select:{id:true,drawingLibraryItemId:true}});
  const products=[...new Set(orders.flatMap(o=>o.drawingLibraryItemId?[o.drawingLibraryItemId]:[]))];
  const records=await prisma.quickQualityRecord.findMany({where:{deletedAt:null,state:'ACTIVE',OR:[{scope:'WORK_ORDER',orders:{some:{workOrderId:{in:ids}}}},{scope:'PRODUCT',productId:{in:products}}]},include:quickInclude,orderBy:{updatedAt:'desc'}});
  for(const record of records.filter(r=>quickEffective(r))) for(const o of orders) {
    if(record.scope==='PRODUCT'?record.productId===o.drawingLibraryItemId:record.orders.some(link=>link.workOrderId===o.id)) result.set(o.id,[...(result.get(o.id)||[]),quickDTO(record)]);
  }
  return result;
}
export async function quickWarningsForProduct(productId:string) {
  const records=await prisma.quickQualityRecord.findMany({where:{deletedAt:null,state:'ACTIVE',scope:'PRODUCT',productId},include:quickInclude,orderBy:{updatedAt:'desc'}});
  return records.filter(r=>quickEffective(r)).map(quickDTO);
}
export async function handoffQuickWarnings(tx:Prisma.TransactionClient, reportId:string, actor:{id:string;name:string}) {
  const records=await tx.quickQualityRecord.findMany({where:{escalatedReportId:reportId,deletedAt:null,state:'ACTIVE'}});
  for(const record of records) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${record.id}, 0))`;
    const changed=await tx.quickQualityRecord.updateMany({where:{id:record.id,state:'ACTIVE',deletedAt:null},data:{state:'OFFLINE',version:{increment:1}}});
    if(!changed.count)continue;
    const dto=quickDTO(await tx.quickQualityRecord.findUniqueOrThrow({where:{id:record.id},include:quickInclude}));
    await tx.quickQualityActivity.create({data:{recordId:record.id,mutationKey:'handoff:'+record.id+':'+dto.version,payloadHash:reportId,version:dto.version,action:'OFFLINE',reason:'关联重大异常已发布，警示已交接',actorId:actor.id,actorName:actor.name,snapshot:dto as unknown as Prisma.InputJsonValue}});
  }
}
export type QuickUpload = { id:string; objectKey:string; displayName:string; mimeType:string; size:number; sha256:string; imageWidth:number; imageHeight:number; imageOrientation:number };
export async function saveQuick(actor:QuickActor,input:Record<string,unknown>,photos:QuickUpload[]) {
  if(!actor.manage) throw new QuickQualityError('没有快处管理权限',403);
  const id=typeof input.id==='string'?input.id:null, key=String(input.mutationKey||'');
  if(!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) throw new QuickQualityError('请刷新后重新提交');
  const description=String(input.description||'').trim();
  if(!description || description.length>3000) throw new QuickQualityError('请填写问题与处理说明，最多 3000 字');
  const orderIds=[...new Set(Array.isArray(input.orderIds)?input.orderIds.map(String):[])];
  if(orderIds.length>20) throw new QuickQualityError('来源工单最多 20 个');
  const requestedProductId=String(input.productId||input.drawingLibraryItemId||'');
  const scope='PRODUCT';
  const active=input.publish===true;
  const keepIds=Array.isArray(input.keepPhotoIds)?input.keepPhotoIds.map(String):[];
  if(keepIds.length+photos.length>12) throw new QuickQualityError('每条记录最多 12 张图片');
  const occurredAt=quickDate(input.occurredAt,'发生日期');
  const effectiveUntil=input.effectiveUntil?quickDate(input.effectiveUntil,'到期日期',true):null;
  if(active && effectiveUntil && effectiveUntil<new Date()) throw new QuickQualityError('警示到期日期不能早于今天');
  const mutationKey=actor.id+':'+key;
  const payloadHash=createHash('sha256').update(JSON.stringify([id,description,requestedProductId,orderIds,scope,active,keepIds,input.occurredAt,input.effectiveUntil,input.processName,input.printPolicy,photos.map(p=>[p.sha256,p.displayName])])).digest('hex');
  return prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id||mutationKey}, 0))`;
    const prior=await tx.quickQualityActivity.findUnique({where:{mutationKey}});
    if(prior) {
      if(prior.payloadHash!==payloadHash) throw new QuickQualityError('同一次提交的内容发生变化，请重新提交',409);
      return { record:quickDTO(await tx.quickQualityRecord.findUniqueOrThrow({where:{id:prior.recordId},include:quickInclude})), kept:false };
    }
    const old=id?await tx.quickQualityRecord.findUnique({where:{id},include:quickInclude}):null;
    if(id && (!old||old.deletedAt)) throw new QuickQualityError('记录不存在或已删除',404);
    if(old && old.version!==Number(input.version)) throw new QuickQualityError('记录已被其他人更新，请刷新后重试',409);
    if(old?.escalatedReportId) throw new QuickQualityError('已转入重大异常，请在关联异常中继续处理',409);
    if(old?.state==='ACTIVE' && !active) throw new QuickQualityError('请通过下线警示操作停止当前警示',409);
    if(keepIds.some(pid=>!old?.photos.some(p=>p.id===pid&&!p.deletedAt))) throw new QuickQualityError('图片不属于当前记录');
    const orders=await tx.workOrder.findMany({where:{id:{in:orderIds},OR:[{deletedAt:null},{id:{in:old?.orders.map(o=>o.workOrderId)||[]}}]},select:{id:true,drawingLibraryItemId:true}});
    if(orders.length!==orderIds.length) throw new QuickQualityError('所选工单已失效，请重新选择');
    const productIds=[...new Set(orders.map(o=>o.drawingLibraryItemId))];
    const productId=requestedProductId||(productIds.length===1?productIds[0]:null);
    const product=productId?await tx.drawingLibraryItem.findFirst({where:{id:productId,deletedAt:null}}):null;
    if(!product) throw new QuickQualityError('请选择一份有效图纸档案；原工单需关联同一份有效图纸');
    if(!old&&orders.some(o=>o.drawingLibraryItemId!==productId)) throw new QuickQualityError('来源工单与所选图纸不一致，请重新选择');
    const newId=id||randomUUID(), version=old?old.version+1:1;
    const data={description,scope,productId,productSignature:null,state:active?'ACTIVE':old?.state==='OFFLINE'?'OFFLINE':'SAVED',
      processName:String(input.processName||'').trim().slice(0,100),occurredAt,effectiveUntil,printPolicy:input.printPolicy==='SYSTEM_ONLY'?'SYSTEM_ONLY':input.printPolicy==='OPTIONAL'?'OPTIONAL':'REQUIRED',version,publishedAt:active?new Date():old?.publishedAt||null};
    if(old) {
      await tx.quickQualityRecord.update({where:{id:newId},data});
      await tx.quickQualityWorkOrder.deleteMany({where:{recordId:newId}});
      await tx.quickQualityAttachment.updateMany({where:{recordId:newId,id:{notIn:keepIds},deletedAt:null},data:{deletedAt:new Date()}});
    } else await tx.quickQualityRecord.create({data:{id:newId,number:'QQ-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+randomUUID().slice(0,8).toUpperCase(),requestKey:mutationKey,createdById:actor.id,createdByName:actor.name,...data}});
    await tx.quickQualityWorkOrder.createMany({data:orderIds.map(workOrderId=>({recordId:newId,workOrderId}))});
    if(photos.length) await tx.quickQualityAttachment.createMany({data:photos.map(p=>({...p,recordId:newId}))});
    const record=await tx.quickQualityRecord.findUniqueOrThrow({where:{id:newId},include:quickInclude});
    const dto=quickDTO(record);
    await tx.quickQualityActivity.create({data:{recordId:newId,mutationKey,payloadHash,version,action:active?'PUBLISH':old?'EDIT':'SAVE',actorId:actor.id,actorName:actor.name,snapshot:dto as unknown as Prisma.InputJsonValue}});
    return {record:dto,kept:true};
  });
}
export async function quickCommand(actor:QuickActor,id:string,input:Record<string,unknown>) {
  if(!actor.manage) throw new QuickQualityError('没有快处管理权限',403);
  const action=String(input.action||''), reason=String(input.reason||'').trim().slice(0,500), key=String(input.mutationKey||'');
  if(!['OFFLINE','DELETE','RESTORE','ESCALATE'].includes(action)||!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) throw new QuickQualityError('操作参数不正确');
  if(action==='RESTORE'&&!actor.admin) throw new QuickQualityError('仅管理员可恢复记录',403);
  if(['OFFLINE','DELETE'].includes(action)&&!reason) throw new QuickQualityError('请选择操作原因');
  return prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
    const mutationKey=actor.id+':'+key, payloadHash=createHash('sha256').update(JSON.stringify([id,action,reason])).digest('hex');
    const previous=await tx.quickQualityActivity.findUnique({where:{mutationKey}});
    if(previous) {
      if(previous.payloadHash!==payloadHash) throw new QuickQualityError('重复请求内容不一致',409);
      return quickDTO(await tx.quickQualityRecord.findUniqueOrThrow({where:{id},include:quickInclude}));
    }
    const old=await tx.quickQualityRecord.findUnique({where:{id},include:quickInclude});
    if(!old) throw new QuickQualityError('记录不存在',404);
    if(old.version!==Number(input.version)) throw new QuickQualityError('记录已更新，请刷新后重试',409);
    if(action==='RESTORE'?!old.deletedAt:!!old.deletedAt) throw new QuickQualityError('记录状态已变化',409);
    if(action==='OFFLINE'&&old.state!=='ACTIVE') throw new QuickQualityError('当前没有生效警示',409);
    let escalatedReportId=old.escalatedReportId;
    if(action==='ESCALATE') {
      if(escalatedReportId) throw new QuickQualityError('已转为重大异常',409);
      const report=await tx.internalQualityRiskReport.create({data:{reportNo:'IQR-QUICK-'+randomUUID().slice(0,8).toUpperCase(),title:old.description.slice(0,180),defectPhenomenon:old.description,occurrenceDate:old.occurredAt,processName:old.processName,createdById:actor.id,updatedById:actor.id,workflowVersion:3}});
      escalatedReportId=report.id;
      await tx.internalQualityRiskWorkOrder.createMany({data:old.orders.map(o=>({reportId:report.id,workOrderId:o.workOrderId,source:'DIRECT'}))});
      const products=old.productId?[old.productId]:[...new Set(old.orders.flatMap(o=>o.workOrder.drawingLibraryItemId?[o.workOrder.drawingLibraryItemId]:[]))];
      if(products.length) await tx.internalQualityRiskProduct.createMany({data:products.map(drawingLibraryItemId=>({reportId:report.id,drawingLibraryItemId}))});
      if(old.photos.filter(p=>!p.deletedAt).length) await tx.internalQualityRiskAttachment.createMany({data:old.photos.filter(p=>!p.deletedAt).map(p=>({reportId:report.id,displayName:p.displayName,originalName:p.displayName,mimeType:p.mimeType,fileSize:p.size,objectKey:p.objectKey,sha256:p.sha256,category:'DEFECT',uploadedById:actor.id,imageWidth:p.imageWidth,imageHeight:p.imageHeight,imageOrientation:p.imageOrientation}))});
      await tx.internalQualityRiskActivity.create({data:{reportId:report.id,action:'QUICK_QUALITY_LINKED',actorId:actor.id,actorName:actor.name,content:'来自异常快处 '+old.number,detail:{quickQualityId:id}}});
    }
    await tx.quickQualityRecord.update({where:{id},data:{state:action==='RESTORE'?'OFFLINE':action==='ESCALATE'?old.state:'OFFLINE',deletedAt:action==='DELETE'?new Date():null,deletedById:action==='DELETE'?actor.id:null,version:{increment:1},escalatedReportId}});
    const dto=quickDTO(await tx.quickQualityRecord.findUniqueOrThrow({where:{id},include:quickInclude}));
    await tx.quickQualityActivity.create({data:{recordId:id,mutationKey,payloadHash,version:dto.version,action,reason,actorId:actor.id,actorName:actor.name,snapshot:dto as unknown as Prisma.InputJsonValue}});
    return dto;
  });
}
