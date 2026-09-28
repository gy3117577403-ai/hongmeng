import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { automaticallyReleaseProductionPlanBatch, effectivePlanningUnitMilliseconds, parseProductionPlanBatchInput, planBatchSnapshot, productionPlanOrderInclude, refreshProductionPlanOrderStatus, resolvePlanningReferences, serializeProductionPlanOrder, editableProductionPlanningWeek } from '@/lib/production-planning';
import { lockOrderPool, distributePoolCoverage } from '@/lib/order-pool-material';
import { PoolError } from '@/lib/order-pool-domain';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(req:NextRequest,{params}:{params:{id:string}}){
 try{
  const user=await requireUser(),body=await req.json().catch(()=>({}));
  const parsed=parseProductionPlanBatchInput(body);if(!parsed.ok)throw new PoolError(parsed.error);
  if(body.poolVersion && !editableProductionPlanningWeek(String(body.weekStartDate||'')))throw new PoolError('请选择当前起未来 12 周内的生产周');
  const key=typeof body.requestKey==='string'?body.requestKey.slice(0,100):'',hash=createHash('sha256').update(JSON.stringify({actor:user.id,id:params.id,body})).digest('hex');
  const updated=await prisma.$transaction(async tx=>{
   await lockOrderPool(tx);await tx.$queryRaw`SELECT id FROM production_plan_orders WHERE id=${params.id} FOR UPDATE`;
   if(key){const replay=await tx.orderPoolCommand.findUnique({where:{key}});if(replay){if(replay.hash!==hash)throw new PoolError('操作编号已使用',409);return replay.result as object;}}
   const order=await tx.productionPlanOrder.findUnique({where:{id:params.id},include:{batches:{select:{batchNo:true,quantity:true,deletedAt:true}},poolMaterialTask:true}});
   if(!order||order.deletedAt)throw new PoolError('计划订单不存在',404);
   if(['cancelled','completed','paused'].includes(order.status))throw new PoolError('订单当前不能继续排产',409);
   if(body.poolVersion && body.poolVersion!==`${order.updatedAt.toISOString()}:${order.preparationVersion}`)throw new PoolError('订单已更新，请重新核对数量与准备状态',409);
   const allocated=order.batches.filter(b=>!b.deletedAt).reduce((n,b)=>n+b.quantity,0);
   if(allocated+parsed.data.quantity>order.orderQuantity)throw new PoolError(`本次排产超过剩余数量 ${Math.max(0,order.orderQuantity-allocated)}`,409);
   const refs=await resolvePlanningReferences(tx,order),unit=effectivePlanningUnitMilliseconds(parsed.data.unitMilliseconds,refs.unitMilliseconds,order.planningUnitMilliseconds);
   const batchNo=Math.max(0,...order.batches.map(b=>b.batchNo))+1;
   if(body.unitMilliseconds!==undefined&&unit&&!order.planningUnitMilliseconds)await tx.productionPlanOrder.update({where:{id:order.id},data:{planningUnitMilliseconds:unit,updatedById:user.id}});
   const batch=await tx.productionPlanBatch.create({data:{planOrderId:order.id,batchNo,quantity:parsed.data.quantity,weekStartDate:parsed.data.weekStartDate,weekEndDate:parsed.data.weekEndDate,plannedCompletionDate:parsed.data.plannedCompletionDate,
    poolPreparationLinked:!!order.poolMaterialTask,productTimeProfileId:refs.productTimeProfileId,productTimeProfileVersion:refs.productTimeProfileVersion,unitMillisecondsSnapshot:unit,planTimeSource:parsed.data.unitMilliseconds?'manual':order.planningUnitMilliseconds?'order':refs.unitMilliseconds?'published':'missing',totalMillisecondsSnapshot:unit?BigInt(unit)*BigInt(parsed.data.quantity):null}});
   await distributePoolCoverage(tx,order.id,user.id);
   await refreshProductionPlanOrderStatus(tx,order.id);
   await tx.productionPlanOrder.update({where:{id:order.id},data:{preparationVersion:{increment:1},updatedById:user.id}});
   await tx.productionPlanChange.create({data:{planOrderId:order.id,batchId:batch.id,action:'create_plan_batch',afterData:planBatchSnapshot({...parsed.data,unitMilliseconds:unit,batchNo}),actorId:user.id}});
   await tx.operationLog.create({data:{userId:user.id,action:'create_production_plan_batch',targetType:'production_plan_batch',targetId:batch.id,detail:{planOrderId:order.id,batchNo,quantity:batch.quantity,poolPreparationLinked:batch.poolPreparationLinked}}});
   const automatic=await automaticallyReleaseProductionPlanBatch(tx,{batchId:batch.id,actorId:user.id,trigger:'automatic_schedule'});
   await distributePoolCoverage(tx,order.id,user.id);
   const record=await tx.productionPlanOrder.findUniqueOrThrow({where:{id:order.id},include:productionPlanOrderInclude});
   const result={order:serializeProductionPlanOrder(record),automaticReleaseTarget:automatic?.target||null,batchId:batch.id};
   if(key)await tx.orderPoolCommand.create({data:{key,hash,result:JSON.parse(JSON.stringify(result))}});
   return result;
  },{maxWait:10000,timeout:30000});
  return NextResponse.json({ok:true,...updated},{status:201});
 }catch(e){if(e instanceof UnauthorizedError)return unauthorized();if(e instanceof PoolError)return NextResponse.json({ok:false,error:e.message},{status:e.status});console.error('create planning batch',e);return NextResponse.json({ok:false,error:'新增排产失败，请刷新后重试'},{status:500});}
}
