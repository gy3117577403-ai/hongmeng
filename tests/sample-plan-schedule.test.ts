import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleWarning, sampleDateRange } from '../lib/sample-plan-view';
import { samplePlanQuery } from '../lib/sample-plan-query';
import { findSamplePlanHeaderRow, parseSamplePlanRow } from '../lib/sample-plan-import';
test('sample deadlines use natural days and stop warning after completion or cancellation', () => {
  const task = { status:'IN_PROGRESS', dueDate:'2026-09-13', warningDays:2 };
  assert.equal(sampleWarning(task,'2026-09-11').kind,'SOON');
  assert.equal(sampleWarning({...task,warningDays:1},'2026-09-11').kind,'NORMAL');
  assert.equal(sampleWarning(task,'2026-09-13').kind,'TODAY');
  assert.equal(sampleWarning(task,'2026-09-14').kind,'OVERDUE');
  assert.equal(sampleWarning({...task,dueDate:null},'2026-09-11').kind,'MISSING');
  for(const status of ['COMPLETED','CANCELLED']) assert.equal(sampleWarning({...task,status},'2026-09-30').kind,'NONE');
  assert.deepEqual(sampleDateRange('week','2026-09-13'),{from:'2026-09-07',to:'2026-09-13'});
  assert.deepEqual(sampleDateRange('month','2028-02-29'),{from:'2028-02-01',to:'2028-02-29'});
});
test('sample filters reject invalid dates and unsafe pagination rather than changing scope', () => {
  for(const query of ['view=bogus','sort=bogus','dateBy=unknown','page=-1','pageSize=500','page=1.5','from=2026-02-30','from=2026-09-12&to=2026-09-11']) assert.throws(()=>samplePlanQuery(new URLSearchParams(query)));
  assert.equal(samplePlanQuery(new URLSearchParams()).view,'UNFINISHED');
  const query = samplePlanQuery(new URLSearchParams({keyword:"' OR 1=1 --_%"}));
  assert.ok(!query.base.sql.includes("' OR 1=1"));
  assert.ok(query.base.values.some(value=>String(value).includes('\\_\\%')));
});
test('new import columns keep issue date distinct and old templates remain supported', () => {
  const headers = ['客户名称','产品名称','型号/规格','客户等级','样品数量','计划出货日期','图纸库编号（选填）','计划下达日期','提前预警天数'];
  const columns = findSamplePlanHeaderRow([headers])!.columns;
  const values = ['测试客户','线束','MODEL-100','A',2,'2026-09-20','','2026-09-11',3];
  const parsed = parseSamplePlanRow(values,2,columns);
  assert.deepEqual(parsed.errors,[]); assert.equal(parsed.row!.issuedDate,'2026-09-11'); assert.equal(parsed.row!.dueDate,'2026-09-20'); assert.equal(parsed.row!.warningDays,3);
  assert.ok(parseSamplePlanRow([...values.slice(0,7),'2026-09-21',3],2,columns).errors.length);
  const old = findSamplePlanHeaderRow([headers.slice(0,6).map(v=>v==='计划出货日期'?'计划日期':v)])!;
  assert.equal(parseSamplePlanRow(values.slice(0,6),2,old.columns).row!.issuedDate,null);
});
