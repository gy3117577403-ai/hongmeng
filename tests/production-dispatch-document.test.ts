import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProductionDispatchDocumentRows,
  renderProductionDispatchPrintHtml,
} from '@/lib/production-dispatch-document';

const orders = [{
  id: 'wo-1',
  code: 'WO-001',
  specification: 'ABC-01',
  customerName: '客户甲',
  productName: '线束',
  stageText: '生产中',
  priority: 'high',
  deliveryDay: '2026-08-15',
  productionTargetQty: 30,
  arrangements: [{
    id: 'arr-1',
    workDate: '2026-08-12',
    shiftCode: 'DAY',
    teamName: '装配组',
    status: 'partial',
    plannedQty: 30,
    completedQty: 12,
    remainingQty: 18,
    processNames: ['裁线', '穿管'],
    employees: [
      { employeeNo: '001', name: '张三', quantity: 9, plannedStandardMilliseconds: '3600000' },
      { employeeNo: '002', name: '李四', quantity: 9, plannedStandardMilliseconds: '7200000' },
    ],
  }],
}];

test('production dispatch export includes arrangement and employee detail', () => {
  const rows = buildProductionDispatchDocumentRows(orders);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].remainingQty, 18);
  assert.equal(rows[0].employees, '001 张三、002 李四');
  assert.equal(rows[0].plannedHours, 3);
});

test('production dispatch export honors selected order scope', () => {
  assert.equal(buildProductionDispatchDocumentRows(orders, ['missing']).length, 0);
  assert.equal(buildProductionDispatchDocumentRows(orders, ['wo-1']).length, 1);
});

test('production dispatch print escapes business content and includes print action', () => {
  const malicious = [{ ...orders[0], productName: '<script>alert(1)</script>' }];
  const html = renderProductionDispatchPrintHtml({
    rows: buildProductionDispatchDocumentRows(malicious),
    generatedAt: new Date('2026-08-12T00:00:00.000Z'),
  });
  assert.match(html, /生产调度排班表/);
  assert.match(html, /window\.print\(\)/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
