import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProductionPlanImportRows, findProductionPlanImportHeaderRow } from '../lib/production-plan-import';
import { productionPlanImportNeedsProductDecision, resolvePlanningImportTime } from '../lib/planning-import-time';
import { productionProcessProgress } from '../lib/production-process-progress';

const headers = ['订单日期*','客户名称*','产品名称*','型号/规格*','订单总量*','本周排产量*','单件计划工时（分钟）','客户交期*','计划完成日期','图纸库编号','客户等级','业务员','备注'];
const values = ['2026-09-03','测试客户','线束','QA-124','100','40','','2026-09-20','2026-09-13','','','',''];
function build(time='', seed='same-file-week', count=1) {
  const row = [...values];row[6]=time;
  return buildProductionPlanImportRows({headers,rows:Array.from({length:count},()=>[...row]),startRowNo:5,targetWeekStartDate:'2026-09-07',targetWeekEndDate:'2026-09-13',libraryItems:[],existingOrders:[],importIdentitySeed:seed});
}
test('13-column template accepts an optional time and generates stable distinct order identities',()=>{
  assert.equal(findProductionPlanImportHeaderRow([['title'],headers]),1);
  const rows=build('',undefined,2);
  assert.equal(rows[0].status,'ready');assert.equal(rows[0].input?.planningUnitMilliseconds,null);
  assert.notEqual(rows[0].input?.sourceOrderNo,rows[1].input?.sourceOrderNo);
  assert.equal(rows[0].input?.sourceOrderNo,build()[0].input?.sourceOrderNo);
  assert.notEqual(rows[0].input?.sourceOrderNo,build('','new-order')[0].input?.sourceOrderNo);
  assert.match(rows[1].warning||'',/独立订单/);
});
test('minutes are converted precisely and invalid supplied times are rejected',()=>{
  for(const [input,ms] of [['0.001',60],['2.125',127500],['1440',86400000]] as const) {
    const row=build(input)[0];assert.equal(row.status,'ready');assert.equal(row.input?.planningUnitMilliseconds,ms);
    assert.deepEqual(row.timePreview,{unitMilliseconds:ms,totalMilliseconds:String(ms*40),source:'import'});
  }
  for(const invalid of ['0','-1','1440.001','1.2345','NaN','2小时','Infinity']) assert.equal(build(invalid)[0].status,'invalid',invalid);
});
test('import time wins without changing formal product times; blank falls back without treating missing as zero',()=>{
  assert.equal(resolvePlanningImportTime({imported:120000,published:60000,order:30000,quantity:40}).source,'import');
  assert.equal(resolvePlanningImportTime({published:60000,order:30000,quantity:40}).source,'published');
  assert.equal(resolvePlanningImportTime({published:0,order:30000,quantity:40}).source,'order');
  assert.deepEqual(resolvePlanningImportTime({quantity:40}),{unitMilliseconds:null,totalMilliseconds:null,source:'missing'});
});
test('skipping a conflict row or choosing a linked existing order needs no unrelated product selection',()=>{
  const row={...build()[0],status:'conflict' as const,requiresOrderDecision:true,orderCandidates:[{id:'old',sourceOrderNo:'SO',sourceLineNo:1,drawingLibraryItemId:'linked',customerDueDate:'2026-09-20',status:'scheduled',deletedAt:null,batchWeekStartDates:[]}]};
  assert.equal(productionPlanImportNeedsProductDecision(row,'skip'),false);
  assert.equal(productionPlanImportNeedsProductDecision(row,'old'),false);
  assert.equal(productionPlanImportNeedsProductDecision(row,'new'),true);
});
test('quantity progress distinguishes pending coverage from remaining reports and supplemental obligations',()=>{
  const steps=productionProcessProgress([
    {id:'done',processName:'裁线',status:'completed',processedQty:40},
    {id:'inspect',processName:'检验',status:'current',inputQty:40,processedQty:0,completedProcessedQuantity:40},
    {id:'pack',processName:'包装',status:'pending',inputQty:0,processedQty:0,completedProcessedQuantity:20},
    {id:'supplement',processName:'压检',status:'current',executionMode:'SUPPLEMENTAL_OBLIGATION',actualRequiredQty:30,supplementRemainingQty:10},
  ],40);
  assert.equal(steps.length,3);assert.equal(steps[0].pending,40);assert.equal(steps[0].remaining,0);assert.equal(steps[0].percentage,0);
  assert.equal(steps[1].remaining,20);assert.equal(steps[2].confirmed,20);assert.equal(steps[2].remaining,10);
});

test('a stale skipped label cannot hide existing reports awaiting coverage', () => {
  const steps = productionProcessProgress([{ id: 'tin', processName: '沾锡', status: 'skipped', inputQty: 0, processedQty: 0, completedProcessedQuantity: 430 }], 430);
  assert.equal(steps.length, 1); assert.equal(steps[0].pending, 430);
  assert.equal(steps[0].reason, '已报 430，待核销 430');
  assert.equal(steps[0].percentage, 0);
});
