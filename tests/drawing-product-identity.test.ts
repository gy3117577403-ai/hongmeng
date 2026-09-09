import assert from 'node:assert/strict';
import test from 'node:test';
import { drawingCustomerIdentity, sameDrawingProduct } from '../lib/drawing-product-identity';
import { buildProductionPlanImportRows } from '../lib/production-plan-import';

test('numeric customer suffixes are compatible but distinct codes remain separate', () => {
  const a = { customerName: '重庆易猫', specification: 'E580LD02030' };
  assert.ok(sameDrawingProduct(a, { ...a, customerName: ' 重庆易猫（１０１９９） ', specification: 'ｅ５８０ｌｄ０２０３０' }));
  assert.ok(!sameDrawingProduct({ ...a, customerName: '重庆易猫(10199)' }, { ...a, customerName: '重庆易猫(10999)' }));
  assert.equal(drawingCustomerIdentity('伽利略（天津）(10304)').name, '伽利略(天津)');
  assert.ok(!sameDrawingProduct(a, { ...a, customerName: '另一个客户' }));
  assert.ok(!sameDrawingProduct(a, { ...a, specification: 'E580LD02030-V02' }));
  assert.ok(!sameDrawingProduct({ ...a, customerName: '重庆易猫(10199)' }, { ...a, customerCode: '10999' }));
});

function preview(customers: string[], override?: string) {
  return buildProductionPlanImportRows({
    headers: ['来源订单号', '订单日期', '客户名称', '产品名称', '型号/规格', '订单总量', '本周排产量', '客户交期', '图纸库编号'],
    rows: [['SO-NEW', '2026-09-09', '杭州昆泰', '线束', 'Ｄ011601-8161-V02', '5', '5', '2026-09-20', override || '']],
    startRowNo: 2, targetWeekStartDate: '2026-09-14', targetWeekEndDate: '2026-09-20', existingOrders: [],
    libraryItems: customers.map((customerName, index) => ({ id: String(index), customerName, specification: 'D011601-8161-V02', productName: '线束', libraryKey: customerName + index, deletedAt: null, drawingFileCount: 1, sopFileCount: 1, productTimeVersion: null })),
  })[0];
}
test('next-week import reuses coded customer archive and retains the selected original ID', () => {
  const row = preview(['杭州昆泰(10033)']);
  assert.equal(row.status, 'ready'); assert.equal(row.productAction, 'reuse'); assert.equal(row.matchedDrawingLibraryItemId, '0');
});
test('multiple compatible archives require a decision and cannot create another archive', () => {
  const row = preview(['杭州昆泰', '杭州昆泰(10033)']);
  assert.equal(row.status, 'conflict'); assert.equal(row.productAction, 'conflict');
  assert.equal(preview(['杭州昆泰', '杭州昆泰(10033)'], '1').matchedDrawingLibraryItemId, '1');
});
test('explicit references cannot link a different customer', () => {
  assert.equal(preview(['其他客户'], '0').status, 'invalid');
});
