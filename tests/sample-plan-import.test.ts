import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { SAMPLE_CUSTOMER_LEVELS, sampleCustomerLevel } from '../lib/sample-customer-levels';
import {
  findSamplePlanHeaderRow,
  parseSamplePlanRow,
  samplePlanFingerprint,
  sampleSpecificationSimilarity,
} from '../lib/sample-plan-import';

test('sample customer levels are the fixed A red, B yellow, C blue, D green contract', () => {
  assert.deepEqual(SAMPLE_CUSTOMER_LEVELS.map(level => [level.code, level.label, level.priority]), [
    ['A', 'A级', 4], ['B', 'B级', 3], ['C', 'C级', 2], ['D', 'D级', 1],
  ]);
  assert.equal(sampleCustomerLevel(' a ')?.color, '#B91C1C');
  assert.equal(sampleCustomerLevel('E'), null);
});

test('sample import parser finds the simple seven-column template and validates typed rows', () => {
  const rows = [
    ['样品计划批量导入模板'],
    ['说明'],
    [],
    ['客户名称', '产品名称', '型号/规格', '客户等级', '样品数量', '计划日期', '图纸库编号（选填）'],
    ['上海锐景', '高压线束', 'SHCJ-DC-V2', 'b', 2, new Date('2026-09-12T00:00:00.000Z'), ''],
  ];
  const header = findSamplePlanHeaderRow(rows);
  assert.ok(header);
  const parsed = parseSamplePlanRow(rows[4], 5, header.columns);
  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(parsed.row && {
    customerName: parsed.row.customerName,
    productName: parsed.row.productName,
    specification: parsed.row.specification,
    customerLevelCode: parsed.row.customerLevelCode,
    sampleQuantity: parsed.row.sampleQuantity,
    dueDate: parsed.row.dueDate,
  }, {
    customerName: '上海锐景', productName: '高压线束', specification: 'SHCJ-DC-V2',
    customerLevelCode: 'B', sampleQuantity: 2, dueDate: '2026-09-12',
  });
});

test('sample import fingerprint blocks exact repeated plans while similarity only proposes review candidates', () => {
  const base = { customerName: '苏州凌动', specification: '8114601007-LD-A.1', customerLevelCode: 'A', sampleQuantity: 2, dueDate: '2026-09-12' };
  assert.equal(samplePlanFingerprint(base), samplePlanFingerprint({ ...base }));
  assert.notEqual(samplePlanFingerprint(base), samplePlanFingerprint({ ...base, dueDate: '2026-09-13' }));
  assert.ok(sampleSpecificationSimilarity('8114601007-LD-A.1', '8114601007 LD A1') > 0.8);
  assert.ok(sampleSpecificationSimilarity('8114601007-LD-A.1', 'SHCJ-FCC400P') < 0.56);
});

test('bulk import routes require preview, idempotent commit, drawing reuse, and no forced duplicate bypass', () => {
  const template = readFileSync('app/api/sample-tasks/import/template/route.ts', 'utf8');
  const preview = readFileSync('app/api/sample-tasks/import/preview/route.ts', 'utf8');
  const commit = readFileSync('app/api/sample-tasks/import/commit/route.ts', 'utf8');
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  const migration = readFileSync('prisma/migrations/202609020006_sample_plan_bulk_import/migration.sql', 'utf8');
  assert.match(template, /SAMPLE_PLAN_IMPORT_HEADERS/);
  assert.match(template, /dataValidation/);
  assert.match(preview, /matchStatus: 'CONFIRM'/);
  assert.match(preview, /系统已有相同计划/);
  assert.match(commit, /sampleTaskImportBatch\.findUnique/);
  assert.match(commit, /pg_advisory_xact_lock/);
  assert.match(commit, /status: \{ not: 'CANCELLED' \}/);
  assert.doesNotMatch(commit, /forceImport|仍然导入|ignoreDuplicate/);
  assert.match(schema, /model SampleTaskImportBatch/);
  assert.match(migration, /sample_task_import_batches_mutation_id_key/);
});
