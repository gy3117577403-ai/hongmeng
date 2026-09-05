import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { emptyReference, type QualityReference } from '../lib/quality-reference';
import { emptyQualityForm } from '../lib/quality-data';
import { createReference, mutateReference, loadReference, referenceVersion, favoriteReference, listReferences } from '../lib/quality-reference-service';
import { createQualityRecord, mutateQualityRecord, qualityHistoricalRecord } from '../lib/quality-data-service';
test('independent references preserve terminal snapshots, revisions, ownership, favorites and concurrency',{skip:process.env.RUN_DB_INTEGRATION!=='1'},async()=>{
  const marker='qr-it-'+randomUUID();
  const actor={id:marker,name:'调模验收',canManage:false,canReview:false},admin={id:marker+'admin',name:'质量验收',canManage:true,canReview:true};
  const terminal=await prisma.terminalToolingTerminal.create({data:{specification:marker,manufacturer:'原厂家',normalizedKey:marker}});
  const ids:string[]=[];
  try{
    const form=emptyReference();Object.assign(form,{terminalName:marker,terminalId:terminal.id,manufacturer:'伪造厂家'});form.data.parameters[0].value='1.2';
    const body={...form,idempotencyKey:randomUUID()};
    const [first,same]=await Promise.all([createReference(actor,body),createReference(actor,body)]);ids.push(first.id);
    assert.equal(first.id,same.id);assert.equal(first.manufacturer,'原厂家');assert.equal('workOrderId' in first,false);
    await assert.rejects(createReference(actor,{...body,title:'改变'}),/提交标识/);
    await assert.rejects(mutateReference(first.id,{...actor,id:'stranger'},{...first,action:'SAVE',reason:'越权'}),/本人/);
    const enabled={...first,status:'ACTIVE',data:{...first.data,wire:'0.5 mm²'}};
    const results=await Promise.allSettled([mutateReference(first.id,actor,enabled),mutateReference(first.id,admin,enabled)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
    let current:QualityReference=await loadReference(first.id,actor.id);
    await assert.rejects(mutateReference(first.id,actor,{...current,title:'无说明'}),/变更说明/);
    await prisma.terminalToolingTerminal.update({where:{id:terminal.id},data:{specification:'新名称',manufacturer:'新厂家',isActive:false}});
    current=await mutateReference(first.id,actor,{...current,reason:'调整高度',data:{...current.data,parameters:current.data.parameters.map(p=>({...p,value:'1.3'}))}});
    assert.equal(current.terminalName,marker);assert.equal(current.manufacturer,'原厂家');
    current=await mutateReference(first.id,actor,{...current,reason:'登记验证依据',data:{...current.data,source:'VERIFIED',verifiedBy:'品质员',verifiedAt:'2026-09-01T09:00+08:00',basis:'现场验证记录'}});
    const verifiedVersion=current.version;
    current=await mutateReference(first.id,actor,{...current,reason:'调整机台后重新验证',data:{...current.data,equipment:'新机台'}});
    assert.equal(current.data.source,'EXPERIENCE');assert.equal(current.data.verifiedAt,'');
    assert.equal((await referenceVersion(first.id,verifiedVersion)).data.source,'VERIFIED');
    assert.equal((await referenceVersion(first.id,1)).data.parameters[0].value,'1.2');
    await assert.rejects(createReference(actor,{...body,idempotencyKey:randomUUID()}),/停用/);
    await assert.rejects(prisma.terminalToolingTerminal.delete({where:{id:terminal.id}}),{code:'P2003'});
    await favoriteReference(first.id,actor.id,true);
    assert.equal((await listReferences(new URLSearchParams({q:marker,favorite:'1'}),actor.id)).total,1);
    assert.equal((await listReferences(new URLSearchParams({q:marker,favorite:'1'}),admin.id)).total,0);
    current=await mutateReference(first.id,actor,{version:current.version,action:'DELETE',reason:'验收删除'});
    assert.equal((await listReferences(new URLSearchParams({q:marker}),actor.id)).total,0);
    await assert.rejects(mutateReference(first.id,actor,{version:current.version,action:'RESTORE',reason:'恢复'}),/管理员/);
    current=await mutateReference(first.id,admin,{version:current.version,action:'RESTORE',reason:'验收恢复'});assert.equal(current.deletedAt,null);
    assert.equal((await referenceVersion(first.id,1)).data.parameters[0].value,'1.2');
  }finally{
    await prisma.qualityReferenceFavorite.deleteMany({where:{referenceId:{in:ids}}});
    await prisma.qualityReferenceRevision.deleteMany({where:{referenceId:{in:ids}}});
    await prisma.qualityReference.deleteMany({where:{id:{in:ids}}});
    await prisma.terminalToolingTerminal.delete({where:{id:terminal.id}});
  }
});
test('inspection team identity and historical name survive renaming and retirement',{skip:process.env.RUN_DB_INTEGRATION!=='1'},async()=>{
  const marker='qt-it-'+randomUUID(),actor={id:marker,name:'品质员',canManage:true,canReview:true};
  const team=await prisma.productionTeam.create({data:{code:marker,name:marker+'班组'}}),order=await prisma.workOrder.create({data:{code:marker,productName:'班组验收',stage:'frontend'}});
  let id='';
  try{
    const data=emptyQualityForm('CRIMP',actor.name);data.teamId=team.id;data.context.team='客户端伪造名称';data.rows[0].value='1.2';
    let record=await createQualityRecord(actor,{workOrderId:order.id,title:'最简登记',type:'CRIMP',data,inspectedAt:new Date().toISOString(),status:'SUBMITTED',idempotencyKey:randomUUID()});id=record.id;
    assert.equal(record.data.context.team,team.name);assert.equal(record.data.teamId,team.id);assert.equal(record.result,'PENDING');
    await prisma.productionTeam.update({where:{id:team.id},data:{name:marker+'新名称',isActive:false}});
    record=await mutateQualityRecord(id,actor,{...record,action:'SAVE',reason:'补充备注',data:{...record.data,summary:'历史班组仍可查看'}});
    assert.equal(record.data.context.team,team.name);assert.equal((await qualityHistoricalRecord(id,1)).data.context.team,team.name);
    await assert.rejects(createQualityRecord(actor,{workOrderId:order.id,title:'停用班组',type:'CRIMP',data,inspectedAt:new Date().toISOString(),idempotencyKey:randomUUID()}),/停用/);
  }finally{if(id){await prisma.qualityDataRevision.deleteMany({where:{recordId:id}});await prisma.qualityDataRecord.delete({where:{id}});}await prisma.workOrder.delete({where:{id:order.id}});await prisma.productionTeam.delete({where:{id:team.id}});}
});
