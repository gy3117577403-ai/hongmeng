import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyReference, referenceInput, resetStaleReferenceVerification } from '../lib/quality-reference';
import { emptyQualityForm, qualityForm, qualityResult, assertQualitySubmission } from '../lib/quality-data';
import { resolveAccessContext } from '../lib/department-access';
import { canAccessApiRoute } from '../lib/api-route-access';
test('minimal inspection accepts one measured row, leaves unused items optional and does not invent PASS',()=>{
  const f=emptyQualityForm('CRIMP','检验人');f.rows[0].value='1.2';f.rows.push({...f.rows[0],item:'外观',value:''});
  assert.doesNotThrow(()=>assertQualitySubmission(qualityForm(f),0));assert.equal(qualityResult(qualityForm(f)),'PENDING');
  f.rows[0].lower='1.1';f.rows[0].upper='1.3';assert.equal(qualityResult(qualityForm(f)),'PASS');
  f.rows[0].value='0';assert.equal(qualityResult(qualityForm(f)),'FAIL');
  f.rows[0].item='';assert.throws(()=>assertQualitySubmission(qualityForm(f),0),/项目名称/);
});
test('file-only submission needs an attachment, but not a redundant summary or process',()=>{
  const f=emptyQualityForm('FIRST','检验人');f.mode='FILE';f.rows=[];
  assert.throws(()=>assertQualitySubmission(f,0),/附件/);assert.doesNotThrow(()=>assertQualitySubmission(f,1));
  f.mode='FORM';assert.doesNotThrow(()=>assertQualitySubmission(f,1));assert.throws(()=>assertQualitySubmission(f,0),/至少/);
});
test('reference measurements and machine settings have independent applicability and units',()=>{
  const f=emptyReference();f.terminalName='端子 A';f.data.parameters[0].value='1.2';
  assert.equal(referenceInput(f).data.parameters[0].unit,'mm');
  f.data.parameters.push({group:'MACHINE',name:'刻度',value:'3.5',unit:'刻度',tolerance:'',note:''});
  assert.throws(()=>referenceInput(f),/机台/);f.data.equipment='机器 A';assert.doesNotThrow(()=>referenceInput(f));
  f.data.parameters[0].value='-1';assert.throws(()=>referenceInput(f),/大于零/);
});
test('reference drafts require real parameters; active schemes require wire applicability and verification needs evidence',()=>{
  const f=emptyReference();f.terminalName='端子';assert.throws(()=>referenceInput(f),/至少一个/);
  f.data.parameters[0].value='1.2';f.status='ACTIVE';assert.throws(()=>referenceInput(f),/线材/);
  f.data.wireSize='0.5';assert.doesNotThrow(()=>referenceInput(f));
  f.data.wireSize='0';assert.throws(()=>referenceInput(f),/规格/);f.data.wireUnit='AWG';assert.doesNotThrow(()=>referenceInput(f));
  f.data.source='VERIFIED';assert.throws(()=>referenceInput(f),/验证人/);
  f.data.verifiedBy='检验员';f.data.verifiedAt='2026-09-01T09:00+08:00';f.data.basis='现场验证报告';assert.doesNotThrow(()=>referenceInput(f));
});
test('reference endpoints inherit the quality access boundary',()=>{
  for(const profile of ['FIELD_REPORTER','PROCESS_SPECIALIST','QUALITY_DATA_OPERATOR','QUALITY_REVIEWER','ADMIN_GLOBAL'] as const){
    const access=resolveAccessContext([{profile,grantType:'PRIMARY',scopeKey:'GLOBAL',departmentCode:profile==='QUALITY_REVIEWER'?'QUALITY':'PRODUCTION'}]);
    for(const path of ['/api/quality-data/references','/api/quality-data/reference-export','/api/quality-data/reference-files/x/content','/api/quality-data/options'])assert.equal(canAccessApiRoute(access,path,'GET'),!['FIELD_REPORTER','PROCESS_SPECIALIST'].includes(profile));
  }
});

test('verification follows a particular setup and cannot be carried onto changed machine parameters',()=>{
  const old=emptyReference();old.terminalName='端子';old.data.parameters[0].value='1.2';old.data.source='VERIFIED';old.data.verifiedBy='品质员';old.data.verifiedAt='2026-09-01T09:00+08:00';old.data.basis='验证记录';
  assert.equal(resetStaleReferenceVerification({...old,title:'改名称'},old).data.source,'VERIFIED');
  const changed={...old,data:{...old.data,parameters:old.data.parameters.map(p=>({...p,value:'1.3'}))}};
  const reset=resetStaleReferenceVerification(changed,old);assert.equal(reset.data.source,'EXPERIENCE');assert.equal(reset.data.verifiedAt,'');assert.equal(old.data.source,'VERIFIED');
  assert.equal(resetStaleReferenceVerification({...old,data:{...old.data,equipment:'不同机台'}},old).data.source,'EXPERIENCE');
  assert.equal(resetStaleReferenceVerification({...changed,data:{...changed.data,verifiedAt:'2026-09-02T09:00+08:00'}},old).data.source,'VERIFIED');
});
