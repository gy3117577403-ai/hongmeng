import assert from 'node:assert/strict';
import test from 'node:test';
import { segmentDays, segmentTotals, worklogRange, stockSummary, TOOLING_POSITIONS, type StockUnit } from '../lib/tooling-worklog-domain';
test('Shanghai cross-midnight work is split exactly; pause is never counted as work',()=>{
  const segments=[{kind:'WORK',startedAt:'2026-09-27T23:30:00+08:00',endedAt:'2026-09-28T00:30:00+08:00'},{kind:'WAIT',startedAt:'2026-09-28T00:30:00+08:00',endedAt:'2026-09-28T00:45:00+08:00'}];
  const now=new Date('2026-09-29T00:00:00+08:00');const days=segmentDays(segments,now);
  assert.deepEqual(days,{'2026-09-27':{workMs:1800000,waitMs:0},'2026-09-28':{workMs:1800000,waitMs:900000}});
  assert.deepEqual(segmentTotals(segments,now),{workMs:3600000,waitMs:900000});
  assert.equal(Object.keys(segmentDays(segments,now,worklogRange('week','2026-09-28'))).join(),'2026-09-28');
  assert.throws(()=>worklogRange('day','2026-02-30'));
});
test('physical kits are not counted twice and loose blades do not silently become a kit',()=>{
  const units:StockUnit[]=TOOLING_POSITIONS.map((position,i)=>({id:String(i),bladeId:'blade',position,kitId:'kit',homeBox:3,currentBox:3,state:'AVAILABLE',version:1}));
  assert.deepEqual([stockSummary(units).total,stockSummary(units).completeKits,stockSummary(units).loose],[4,1,0]);
  assert.equal(stockSummary(units.map(u=>({...u,kitId:null}))).completeKits,0);
  assert.equal(stockSummary(units.slice(1)).incompleteKits,1);
  assert.equal(stockSummary(units.map((u,i)=>i?u:{...u,state:'IN_USE',currentBox:null})).completeKits,0);
});
