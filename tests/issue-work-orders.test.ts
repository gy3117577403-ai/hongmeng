import assert from 'node:assert/strict';
import test from 'node:test';
import {
  issueWorkOrderPageOffset,
  issueWorkOrderSearchWhere,
  parseIssueWorkOrderDraft,
  serializeIssueWorkOrderOption,
} from '../lib/issue-work-orders';

test('issue work order draft requires a code and product name', () => {
  assert.deepEqual(parseIssueWorkOrderDraft(null), { draft: null, errors: [] });
  assert.deepEqual(parseIssueWorkOrderDraft('invalid').errors, ['待创建工单格式不正确']);
  assert.deepEqual(parseIssueWorkOrderDraft({ code: 'WO-1', productName: '' }).errors, ['待创建工单的产品名称不能为空']);
  assert.deepEqual(parseIssueWorkOrderDraft({ code: '', productName: '产品' }).errors, ['待创建工单的工单号不能为空']);
});

test('issue work order draft trims and limits user input', () => {
  const parsed = parseIssueWorkOrderDraft({
    code: '  WO-100  ',
    productName: '  电源线束  ',
    customerName: '  测试客户  ',
    specification: '  SPEC-100  ',
    sourceOrderNo: '  SO-100  ',
    remark: '  后续补图  ',
  });
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.draft, {
    code: 'WO-100',
    productName: '电源线束',
    customerName: '测试客户',
    specification: 'SPEC-100',
    sourceOrderNo: 'SO-100',
    remark: '后续补图',
  });
});

test('issue work order search covers all user-facing identity fields without active-plan filtering', () => {
  const where = issueWorkOrderSearchWhere('ABC');
  assert.equal(where.deletedAt, null);
  assert.equal(Array.isArray(where.OR), true);
  assert.equal((where.OR as unknown[]).length, 6);
  assert.equal('planActive' in where, false);
  assert.equal('planClearedAt' in where, false);
});

test('issue work order paging does not duplicate the exact match promoted onto page one', () => {
  assert.equal(issueWorkOrderPageOffset(1, 50, true), 0);
  assert.equal(issueWorkOrderPageOffset(2, 50, true), 49);
  assert.equal(issueWorkOrderPageOffset(3, 50, true), 99);
  assert.equal(issueWorkOrderPageOffset(2, 50, false), 50);
});

test('issue work order option preserves historical and branch state', () => {
  const serialized = serializeIssueWorkOrderOption({
    id: 'wo-1',
    code: 'WO-1',
    businessCode: 'SC-1',
    customerName: '客户',
    productName: '产品',
    specification: 'SPEC-1',
    sourceOrderNo: 'SO-1',
    stage: 'completed',
    status: 'done',
    drawingStatus: null,
    planActive: false,
    planClearedAt: new Date('2026-08-01T00:00:00.000Z'),
    branchType: 'REWORK',
    deletedAt: null,
    updatedAt: new Date('2026-08-02T00:00:00.000Z'),
  });
  assert.equal(serialized.displayCode, 'SPEC-1');
  assert.equal(serialized.stageText, '已完成');
  assert.equal(serialized.planActive, false);
  assert.equal(serialized.planClearedAt, '2026-08-01T00:00:00.000Z');
  assert.equal(serialized.branchType, 'REWORK');
});
