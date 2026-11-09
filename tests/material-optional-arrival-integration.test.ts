import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {prisma} from '../lib/prisma';
import {mutateMaterialOrder,readMaterialOrder} from '../lib/material-order-service';
import {materialOrderFilterWhere} from '../lib/material-order-filters';

test('blank arrival quantities preserve shipping facts, retry identity and product preparation', {skip:process.env.RUN_DB_INTEGRATION!=='1'},async()=>{
  const db=new URL(process.env.DATABASE_URL!);assert.ok(['127.0.0.1','localhost'].includes(db.hostname)&&/_test$|_ci$/.test(db.pathname));
  const marker='optional-'+randomUUID();const user=await prisma.user.create({data:{username:marker,displayName:'选填到料验收',passwordHash:'test-only'}});
  const plan=await prisma.productionPlanOrder.create({data:{sourceOrderNo:marker,sourceLineNo:1,productName:marker,specification:marker,customerName:marker,orderQuantity:10,orderDate:new Date(),customerDueDate:new Date()}});
  let order=await readMaterialOrder((await prisma.warehouseMaterialTask.create({data:{planOrderId:plan.id}})).id);
  const change=async(action:string,values:Record<string,unknown>={},canConfirm=true)=>{order=await mutateMaterialOrder(order.id,{action,version:order.version,requestKey:randomUUID(),...values},user.id,canConfirm);return order;};
  try{
    await change('report_exception',{materialModel:'端子',exceptionType:'shortage',supplySource:'PURCHASED',shortageQuantity:10,unit:'件'});const id=order.events[0].id;
    await change('record_shipment',{exceptionId:id,quantity:10,logisticsMode:'PICKUP'});const batchId=order.events[0].arrivals[0].id;
    await assert.rejects(change('confirm_arrival',{exceptionId:id,arrivalId:batchId,quantity:''},false),/权限/);
    const input={action:'confirm_arrival',version:order.version,requestKey:randomUUID(),exceptionId:id,arrivalId:batchId,quantity:'',hasIssue:true,note:'外箱破损，数量稍后核对'};
    order=await mutateMaterialOrder(order.id,input,user.id,true);await mutateMaterialOrder(order.id,input,user.id,true);
    const pending=order.events[0].arrivals[0];assert.equal(pending.id,batchId);assert.equal(pending.quantity,null);assert.equal(pending.declaredQuantity,10);assert.equal(pending.issuePending,true);
    assert.equal(pending.status,'QUANTITY_PENDING');assert.equal(order.events[0].usable,0);assert.equal(order.events[0].pending,0);assert.equal(order.events[0].transit,0);assert.equal(order.events[0].unallocated,0);assert.equal(order.preparedQuantity,0);assert.notEqual(order.state,'READY');
    assert.equal(order.events[0].arrivals.length,1);assert.equal(order.events[0].phase,'QUANTITY_PENDING');
    assert.equal(await prisma.warehouseMaterialTask.count({where:{AND:[{id:order.id},materialOrderFilterWhere('waiting')]}}),1);
    await assert.rejects(change('confirm_outcome',{exceptionId:id,arrivalOutcome:'COMPLETE',note:'未清点'}),/批次/);
    await assert.rejects(change('verify_arrivals',{entries:[{arrivalId:batchId,acceptedQuantity:0}]}),/待补录/);
    await assert.rejects(change('confirm_arrival',{exceptionId:id,arrivalId:batchId,quantity:8}),/处理说明/);
    await assert.rejects(change('confirm_arrival',{exceptionId:id,arrivalId:batchId,quantity:11,note:'核对'}),/超过/);
    await change('confirm_arrival',{exceptionId:id,arrivalId:batchId,quantity:8,acceptedQuantity:7,note:'核对7件可用、1件破损，2件未到'});
    assert.equal(order.events[0].arrivals.find(b=>b.id===batchId)!.quantity,8);assert.equal(order.events[0].arrivals.find(b=>b.id===batchId)!.declaredQuantity,10);
    assert.equal(order.events[0].usable,7);assert.equal(order.events[0].rejected,1);assert.equal(order.events[0].transit,2);assert.equal(order.events[0].missing,3);
    await change('confirm_arrival',{exceptionId:id,arrivalId:order.events[0].arrivals.find(b=>b.status==='SHIPPED')!.id,quantity:2});
    await change('confirm_arrival',{exceptionId:id,quantity:1});assert.equal(order.events[0].status,'RESOLVED');assert.equal(order.events[0].usable,10);assert.equal(order.preparedQuantity,0);
    await change('report_exception',{materialModel:'未知总量',exceptionType:'shortage',supplySource:'CUSTOMER',shortageQuantity:'',unit:'件'});const second=order.events[1].id;
    await change('confirm_arrival',{exceptionId:second});const secondBatch=order.events[1].arrivals[0];assert.equal(secondBatch.quantity,null);assert.equal(secondBatch.declaredQuantity,null);
    await assert.rejects(change('confirm_arrival',{exceptionId:second,arrivalId:secondBatch.id,quantity:'',confirmComplete:true}),/待补录/);
    await change('confirm_arrival',{exceptionId:second,arrivalId:secondBatch.id,quantity:5});assert.equal(order.events[1].phase,'NEEDS_COMPLETION');
    await change('confirm_outcome',{exceptionId:second,arrivalOutcome:'COMPLETE',note:'实物核对全部补齐'});assert.equal(order.events[1].status,'RESOLVED');assert.equal(order.preparedQuantity,0);
  }finally{await prisma.warehouseMaterialTask.delete({where:{id:order.id}});await prisma.productionPlanOrder.delete({where:{id:plan.id}});await prisma.operationLog.deleteMany({where:{userId:user.id}});await prisma.user.delete({where:{id:user.id}});await prisma.$disconnect();}
});
