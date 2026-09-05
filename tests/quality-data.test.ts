import assert from 'node:assert/strict';
import test from 'node:test';
import { qualityDate, emptyQualityForm, qualityForm, qualityResult, assertQualitySubmission, assertQualityEdit } from '../lib/quality-data';
import { resolveAccessContext } from '../lib/department-access';
import { canAccessApiRoute } from '../lib/api-route-access';
import { canAccessAppRoute } from '../lib/app-route-access';
import { qualityFileType } from '../lib/quality-data-files';
test('unmeasured rows, missing standards and file-only entries never become passing results',()=>{
  const form=emptyQualityForm('PULL');assert.equal(qualityResult(qualityForm(form)),'PENDING');
  form.rows[0].value='100';form.rows[0].result='PASS';
  assert.equal(qualityResult(qualityForm(form)),'PENDING');
  form.rows[0].lower='100';assert.equal(qualityResult(qualityForm(form)),'PASS');
  form.rows[0].value='99.999999';assert.equal(qualityResult(qualityForm(form)),'FAIL');
  form.rows[0].upper='90';assert.throws(()=>qualityForm(form),/下限/);
  assert.throws(()=>assertQualitySubmission(emptyQualityForm('FIRST'),0),/检验人/);
});
test('Beijing dates retain actual inspection day and invalid calendar dates are rejected',()=>{
  assert.equal(qualityDate('2026-09-01T00:30').toISOString(),'2026-08-31T16:30:00.000Z');
  assert.throws(()=>qualityDate('2026-02-30T12:00'),/不存在/);
  assert.throws(()=>qualityDate('2026-01-01T25:00'),/日期|时间/);
});
test('quantity consistency and result derivation cannot be bypassed with client PASS',()=>{
  const f=emptyQualityForm('FINAL','张检验');
  Object.assign(f.context,{processName:'成品',inspectionQty:'10',sampleQty:'20'});
  assert.throws(()=>qualityForm(f),/抽样数量/);
  Object.assign(f.context,{sampleQty:'5',defectQty:'6'});
  assert.throws(()=>qualityForm(f),/不良数量/);
  f.context.defectQty='1';assert.equal(qualityResult(qualityForm(f)),'FAIL');
});
test('quality module is restricted to authorized roles and grants compose without opening production APIs',()=>{
  const role=(profile:string,departmentCode='PRODUCTION')=>resolveAccessContext([{profile:profile as 'QUALITY_DATA_OPERATOR',grantType:'PRIMARY',scopeKey:'GLOBAL',departmentCode:departmentCode as 'PRODUCTION'}]);
  for(const profile of ['FIELD_REPORTER','PROCESS_SPECIALIST','WORKSHOP_SUPERVISOR','GM_OFFICE_READER_APPROVER']){
    const access=role(profile,profile==='PROCESS_SPECIALIST'?'PROCESS':'PRODUCTION');
    assert.equal(canAccessAppRoute(access,'/workspace/quality/data'),false,profile);
    for(const endpoint of ['/api/quality-data/records','/api/quality-data/export','/api/quality-data/attachments/x/content'])assert.equal(canAccessApiRoute(access,endpoint,'GET'),false,profile+endpoint);
  }
  for(const profile of ['QUALITY_DATA_OPERATOR','WORKSHOP_TEAM_LEADER','QUALITY_REVIEWER','ADMIN_GLOBAL']){
    const access=role(profile,profile==='QUALITY_REVIEWER'?'QUALITY':'PRODUCTION');
    assert.equal(canAccessAppRoute(access,'/workspace/quality/data'),true,profile);
    assert.equal(canAccessApiRoute(access,'/api/quality-data/records','POST'),true,profile);
  }
  const quality=role('QUALITY_REVIEWER','QUALITY');
  assert.equal(canAccessAppRoute(quality,'/field-report/old-code'),true);
  assert.equal(canAccessApiRoute(quality,'/api/field-report/tickets/old-code/completions','POST'),false);
  const expired=resolveAccessContext([{profile:'QUALITY_DATA_OPERATOR',grantType:'ACTING',scopeKey:'GLOBAL',effectiveTo:'2026-01-01'}],{now:new Date('2026-09-05')});
  assert.equal(canAccessApiRoute(expired,'/api/quality-data/export','GET'),false);
});
test('attachment extension and actual bytes must agree',()=>{
  assert.throws(()=>qualityFileType('inspection.xlsx',10,Buffer.alloc(10)),/Excel/);
  assert.throws(()=>qualityFileType('inspection.pdf',5,Buffer.from('hello')),/PDF/);
  assert.throws(()=>qualityFileType('inspection.html',5,Buffer.from('hello')),/支持/);
  assert.equal(qualityFileType('inspection.pdf',8,Buffer.from('%PDF-1.7')),'application/pdf');
});
test('ordinary submitters cannot edit another person record or a discarded record',()=>{
  const actor={id:'a',name:'a',canManage:false,canReview:false};
  assert.throws(()=>assertQualityEdit(actor,{createdById:'b',status:'DRAFT',deletedAt:null}),/本人/);
  assert.throws(()=>assertQualityEdit(actor,{createdById:'a',status:'DRAFT',deletedAt:new Date()}),/回收站/);
});
