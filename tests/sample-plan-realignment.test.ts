import assert from 'node:assert/strict';
import test from 'node:test';
import {sampleUnitTime,samplePlanTime,sampleHours} from '../lib/sample-plan-time';
import {parseSamplePlanRow,findSamplePlanHeaderRow,samplePlanFingerprint,SAMPLE_PLAN_IMPORT_HEADERS} from '../lib/sample-plan-import';
import {sampleDocumentState,samplePrimaryAction} from '../lib/sample-workbench-view';
import type {SampleTaskDTO} from '../types';
test('sample planning uses exact minute snapshots and distinguishes missing hours and quantities',()=>{
 assert.equal(sampleUnitTime('12.5'),750000);assert.equal(sampleUnitTime('0.001'),60);assert.equal(sampleUnitTime(''),null);
 for(const invalid of ['0','-1','12分钟','0.0001','1e2','1440.001'])assert.throws(()=>sampleUnitTime(invalid));
 const task={sampleQuantity:24,unitPlannedMilliseconds:750000,completedQuantity:8};
 const time=samplePlanTime(task);assert.equal(time.totalPlannedMilliseconds,'18000000');assert.equal(sampleHours(time.totalPlannedMilliseconds),'5');assert.equal(time.remainingPlannedMilliseconds,'12000000');
 assert.equal(samplePlanTime({...task,completedQuantityKnown:false}).remainingPlannedMilliseconds,null);
 assert.equal(samplePlanTime({...task,status:'COMPLETED'}).remainingQuantity,0);
 assert.equal(samplePlanTime({...task,status:'CANCELLED'}).remainingPlannedMilliseconds,'0');
 assert.equal(samplePlanTime({...task,unitPlannedMilliseconds:null}).totalPlannedMilliseconds,null);
 assert.equal(samplePlanTime({sampleQuantity:2147483647,unitPlannedMilliseconds:86400000}).totalPlannedMilliseconds,(2147483647n*86400000n).toString());
});
test('Excel defaults inherit the chosen branch and week while explicit cells win',()=>{
 const columns=findSamplePlanHeaderRow([Array.from(SAMPLE_PLAN_IMPORT_HEADERS)])!.columns;
 const row=Array(SAMPLE_PLAN_IMPORT_HEADERS.length).fill('');const set=(key:string,value:unknown)=>{row[columns[key]]=value;};
 set('客户名称','验收客户');set('产品名称','样品线束');set('型号/规格','S-001');set('客户等级','A');set('样品数量',24);set('计划日期','2026-10-01');set('单套计划工时（分钟/套）',12.5);
 const inherited=parseSamplePlanRow(row,4,columns,{taskType:'REPEAT',planWeekStartDate:'2026-09-21'});
 assert.deepEqual(inherited.errors,[]);assert.equal(inherited.row!.taskType,'REPEAT');assert.equal(inherited.row!.planWeekStartDate,'2026-09-21');assert.equal(inherited.row!.unitPlannedMinutes,12.5);
 set('样品类型（选填）','新品');set('计划周（选填）','2026-09-30');const explicit=parseSamplePlanRow(row,4,columns,{taskType:'REPEAT',planWeekStartDate:'2026-09-21'});
 assert.equal(explicit.row!.taskType,'NEW');assert.equal(explicit.row!.planWeekStartDate,'2026-09-28');
 set('计划周（选填）','待排期');assert.equal(parseSamplePlanRow(row,4,columns,{taskType:'NEW',planWeekStartDate:'2026-09-21'}).row!.planWeekStartDate,null);
});
test('same products from two orders remain separate while one plan identity survives edits',()=>{
 const row={customerName:'客户',specification:'S-1',customerLevelCode:'A',sampleQuantity:5,dueDate:'2026-09-30',sourceOrderNo:'ORDER-A',sourceOrderLine:'1'};
 assert.notEqual(samplePlanFingerprint(row),samplePlanFingerprint({...row,sourceOrderNo:'ORDER-B'}));
 assert.equal(samplePlanFingerprint(row),samplePlanFingerprint({...row,sampleQuantity:10,dueDate:'2026-10-01'}));
 assert.equal(samplePlanFingerprint({...row,planCode:'YP-1'}),samplePlanFingerprint({...row,planCode:'YP-1',sourceOrderNo:'EDITED'}));
});
test('row actions reflect next work instead of conflating upload, review and completion',()=>{
 const task={status:'PLANNED',taskType:'NEW',dataStatus:'NO_DATA',documentReviewRequired:true,drawingDocumentCount:0,drawingReviewStatus:null,counts:{pendingReview:0}} as SampleTaskDTO;
 assert.equal(sampleDocumentState(task).label,'待上传');assert.equal(samplePrimaryAction(task).label,'上传资料');
 assert.equal(samplePrimaryAction({...task,drawingReviewStatus:'RETURNED',drawingDocumentCount:1}).label,'处理退回');
 assert.equal(samplePrimaryAction({...task,drawingReviewStatus:'APPROVED',dataStatus:'PROCESSED'}).label,'登记完成');
 assert.equal(samplePrimaryAction({...task,status:'COMPLETED'}).label,'查看记录');
});
