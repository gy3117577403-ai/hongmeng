import assert from 'node:assert/strict';
import test from 'node:test';
import { matchImportDrawing, sameImportCustomer, type ImportDrawingArchive } from '../lib/import-drawing-association';
import { buildProductionPlanImportRows, type ProductionPlanImportExistingOrder } from '../lib/production-plan-import';
import { apiRouteAccessRule } from '../lib/api-route-access';
import { moduleApiDecision } from '../lib/module-permissions';

const item:ImportDrawingArchive={id:'drawing-1',libraryKey:'archive-1',customerName:'客户甲(10001)',specification:'D010240-8417-V01',productName:'线束',drawingFileCount:2,sopFileCount:1};
const row={customerName:'客户甲',specification:item.specification};
test('customer and exact revision match one library archive, regardless of work orders',()=>{
  assert.equal(matchImportDrawing(row,[item]).matchedItemId,item.id);
  assert.equal(matchImportDrawing({...row,specification:'d010240-8417-v01'},[item]).matchStatus,'REUSE');
  assert.equal(matchImportDrawing({...row,customerName:'客户乙'},[item]).matchStatus,'CREATE');
  assert.equal(matchImportDrawing({...row,specification:'D010240-8417-V02'},[item]).matchStatus,'CREATE');
  assert.equal(matchImportDrawing({...row,libraryKey:item.id,customerName:'客户乙'},[item]).matchStatus,'BLOCKED');
});
test('deleted archives cannot be silently revived and ambiguous archives require choice',()=>{
  assert.equal(matchImportDrawing(row,[{...item,deletedAt:'2026-09-28'}]).matchStatus,'BLOCKED');
  assert.equal(matchImportDrawing(row,[item,{...item,id:'legacy-2',libraryKey:'legacy-2'}]).matchStatus,'CONFIRM');
  assert.equal(matchImportDrawing({...row,libraryKey:'legacy-2'},[item,{...item,id:'legacy-2',libraryKey:'legacy-2'}]).matchedItemId,'legacy-2');
  assert.equal(matchImportDrawing({...row,libraryKey:'missing'},[item]).matchStatus,'BLOCKED');
});
test('customer normalization preserves codes and location distinctions',()=>{
  assert.equal(sameImportCustomer('客户甲（10001）','客户甲'),true);
  assert.equal(sameImportCustomer('客户甲(10001)','客户甲(10002)'),false);
  assert.equal(sameImportCustomer('客户甲（天津）','客户甲'),false);
});
const headers=['订单日期','客户名称','产品名称','型号/规格','订单总量','本周排产量','单件计划工时（分钟）','客户交期'];
const values=['2026-09-29','客户甲','线束',item.specification,'100','20','2','2026-10-20'];
const prior:ProductionPlanImportExistingOrder={id:'order-1',sourceOrderNo:'SO-1',sourceLineNo:1,drawingLibraryItemId:item.id,customerName:'客户甲',specification:item.specification,orderDate:'2026-09-10',orderQuantity:100,remainingQuantity:80,customerDueDate:'2026-10-10',status:'scheduled',deletedAt:null,batchWeekStartDates:['2026-09-14']};
function build(orders:ProductionPlanImportExistingOrder[],rows:string[][]=[values]) {return buildProductionPlanImportRows({headers,rows,startRowNo:2,targetWeekStartDate:'2026-10-05',targetWeekEndDate:'2026-10-11',libraryItems:[],existingOrders:orders,importIdentitySeed:'drawing-import-test'});}
test('same specification alone does not force continuation of an old order',()=>{
  const next=build([prior])[0];assert.equal(next.requiresOrderDecision,false);assert.equal(next.orderCandidates?.[0].id,'order-1');
  assert.equal(build([{...prior,remainingQuantity:10}])[0].orderCandidates?.length,0);
});
test('identical business orders and duplicate file rows require an explicit decision',()=>{
  assert.equal(build([{...prior,orderDate:'2026-09-29',customerDueDate:'2026-10-20'}])[0].requiresOrderDecision,true);
  assert.equal(build([],[values,values])[1].requiresOrderDecision,true);
  const partial=[...values];partial[5]='10';assert.equal(build([],[values,partial])[1].requiresOrderDecision,true);
});
test('import archive and file previews are read-only for plan and sample business roles',()=>{
  for(const path of ['/api/planning/import/drawings','/api/planning/import/drawings/files/123/content','/api/planning/import/drawings/files/123/download']) {
    const rule=apiRouteAccessRule(path);assert.equal(rule?.action,'READ');assert.ok(rule?.anyOf.includes('PLANNING'));assert.ok(rule?.anyOf.includes('BUSINESS'));assert.deepEqual(rule?.allowedMethods,['GET','HEAD']);
  }
});

test('only production and technical read dependencies permit archive lookup',()=>{
  for(const module of ['production','technology'] as const) {
    const user={modulePermissions:{[module]:'READ' as const},workbenchEnabled:true};
    assert.equal(moduleApiDecision(user,'/api/planning/import/drawings/files/123/content','GET'),true);
    assert.equal(moduleApiDecision(user,'/api/planning/import/commit','POST'),false);
  }
  assert.equal(moduleApiDecision({modulePermissions:{people:'COLLABORATE'},workbenchEnabled:true},'/api/planning/import/drawings','GET'),false);
});
