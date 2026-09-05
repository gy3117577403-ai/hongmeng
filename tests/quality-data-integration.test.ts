import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { createQualityRecord, loadQualityRecord, mutateQualityRecord, qualityHistoricalRecord, listQualityRecords } from '../lib/quality-data-service';
import { emptyQualityForm } from '../lib/quality-data';
test('quality data preserves order identity, original failures, edits, deletion history and concurrent versions',{
  skip:process.env.RUN_DB_INTEGRATION!=='1',
},async()=>{
  const marker='qdit-'+randomUUID();
  const order=await prisma.workOrder.create({data:{code:marker,productName:'共同型号',specification:'SAME-MODEL',stage:'completed'}});
  const other=await prisma.workOrder.create({data:{code:marker+'-other',productName:'共同型号',specification:'SAME-MODEL',stage:'frontend'}});
  const actor={id:marker,name:'质量集成验收',canManage:true,canReview:true}, submitter={id:marker+'-worker',name:'填报员',canManage:false,canReview:false};
  const data=emptyQualityForm('PULL','验收员');data.context.processName='拉力测试';Object.assign(data.rows[0],{standard:'验收标准',lower:'80',value:'70',unit:'N'});
  const body={workOrderId:order.id,type:'PULL',title:'拉力不合格',inspectedAt:'2026-09-01T00:30',data,status:'SUBMITTED',idempotencyKey:randomUUID()};
  const ids:string[]=[];
  try{
    const [first,duplicate]=await Promise.all([createQualityRecord(submitter,body),createQualityRecord(submitter,body)]);
    ids.push(first.id);assert.equal(first.id,duplicate.id);assert.equal(first.result,'FAIL');
    await assert.rejects(createQualityRecord(submitter,{...body,title:'changed'}),/提交标识/);
    await assert.rejects(mutateQualityRecord(first.id,{...submitter,id:'someone-else'},{version:first.version,action:'SAVE',reason:'修订',title:first.title,inspectedAt:first.inspectedAt,data}),/本人/);
    const candidates=await Promise.allSettled([
      mutateQualityRecord(first.id,actor,{version:first.version,action:'REVIEW',reason:'确认测量事实'}),
      mutateQualityRecord(first.id,actor,{version:first.version,action:'REVIEW',reason:'并发复核'}),
    ]);
    assert.equal(candidates.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(candidates.filter(r=>r.status==='rejected').length,1);
    let current=await loadQualityRecord(first.id);
    assert.equal(current.reviewStatus,'APPROVED');
    const old=await qualityHistoricalRecord(first.id,1);assert.equal(old.result,'FAIL');assert.equal(old.reviewStatus,'UNREVIEWED');
    await prisma.workOrder.update({where:{id:order.id},data:{specification:'改名后的型号',weekStartDate:new Date('2026-10-01')}});
    current=await mutateQualityRecord(first.id,actor,{version:current.version,action:'SAVE',reason:'补充测量说明',title:first.title,inspectedAt:first.inspectedAt,data});
    assert.equal(current.reviewStatus,'UNREVIEWED');assert.equal(current.orderSnapshot.specification,'SAME-MODEL');
    const retestData=emptyQualityForm('PULL','复检员');retestData.context.processName='拉力测试';Object.assign(retestData.rows[0],{standard:'验收标准',lower:'80',value:'90',unit:'N'});
    const retest=await createQualityRecord(actor,{...body,data:retestData,title:'复检',supersedesId:first.id,idempotencyKey:randomUUID()});ids.push(retest.id);
    assert.equal(retest.result,'PASS');assert.equal((await loadQualityRecord(first.id)).result,'FAIL');
    await assert.rejects(createQualityRecord(actor,{...body,workOrderId:other.id,supersedesId:first.id,idempotencyKey:randomUUID()}),/同一工单/);
    const september=await listQualityRecords(new URLSearchParams({period:'custom',startDate:'2026-09-01',endDate:'2026-09-01',workOrderId:order.id}));
    assert.equal(september.total,2);
    assert.equal((await listQualityRecords(new URLSearchParams({period:'all',workOrderId:other.id}))).total,0);
    await assert.rejects(mutateQualityRecord(first.id,submitter,{version:current.version,action:'DELETE',reason:'删除'}),/质量人员/);
    current=await mutateQualityRecord(first.id,actor,{version:current.version,action:'DELETE',reason:'验收作废'});
    assert.ok(current.deletedAt);
    assert.equal((await listQualityRecords(new URLSearchParams({period:'all',workOrderId:order.id}))).total,1);
    current=await mutateQualityRecord(first.id,actor,{version:current.version,action:'RESTORE',reason:'验收恢复'});
    assert.equal(current.deletedAt,null);
    assert.equal((await qualityHistoricalRecord(first.id,1)).title,'拉力不合格');
    await assert.rejects(prisma.workOrder.delete({where:{id:order.id}}),{code:'P2003'});
  }finally{
    await prisma.qualityDataRevision.deleteMany({where:{recordId:{in:ids}}});
    await prisma.qualityDataRecord.deleteMany({where:{supersedesId:{in:ids}}});
    await prisma.qualityDataRecord.deleteMany({where:{id:{in:ids}}});
    await prisma.workOrder.deleteMany({where:{id:{in:[order.id,other.id]}}});
  }
});
