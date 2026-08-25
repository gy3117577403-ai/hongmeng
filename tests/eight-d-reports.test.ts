import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  EightDReportError,
  nextCurrentEightDVersion,
  normalizeEightDRelationIds,
  parseEightDReportMetadata,
} from '../lib/eight-d-reports';

const repositoryRoot = resolve(import.meta.dirname, '..');
const migration = readFileSync(
  resolve(repositoryRoot, 'prisma/migrations/202608260001_eight_d_pdf_archive/migration.sql'),
  'utf8',
);
const schema = readFileSync(resolve(repositoryRoot, 'prisma/schema.prisma'), 'utf8');
const component = readFileSync(resolve(repositoryRoot, 'components/EightDArchiveShell.tsx'), 'utf8');

test('8D metadata parser trims fields and de-duplicates both relation collections', () => {
  const parsed = parseEightDReportMetadata({
    reportNo: ' 8D-2026-001 ',
    title: '  客诉端子压接异常  ',
    reportDate: '2026-08-26',
    responsibleDepartment: ' 质量部 ',
    keywords: ' 客诉  压接 ',
    status: 'active',
    productIds: JSON.stringify(['product-a', 'product-a', 'product-b']),
    issueIds: ['issue-a', 'issue-a', 'issue-b'],
  });

  assert.equal(parsed.reportNo, '8D-2026-001');
  assert.equal(parsed.title, '客诉端子压接异常');
  assert.equal(parsed.responsibleDepartment, '质量部');
  assert.equal(parsed.keywords, '客诉 压接');
  assert.deepEqual(parsed.productIds, ['product-a', 'product-b']);
  assert.deepEqual(parsed.issueIds, ['issue-a', 'issue-b']);
  assert.ok(parsed.reportDate instanceof Date);
});

test('8D metadata parser rejects incomplete or unsupported metadata', () => {
  assert.throws(
    () => parseEightDReportMetadata({ reportNo: '', title: '标题' }),
    (error: unknown) => error instanceof EightDReportError && error.message === '报告编号不能为空',
  );
  assert.throws(
    () => parseEightDReportMetadata({ reportNo: '8D-1', title: '标题', status: 'draft' }),
    (error: unknown) => error instanceof EightDReportError && error.message === '8D档案状态不正确',
  );
  assert.throws(
    () => normalizeEightDRelationIds(Array.from({ length: 201 }, (_, index) => `p-${index}`)),
    (error: unknown) => error instanceof EightDReportError && error.message.includes('最多关联 200'),
  );
});

test('deleting a PDF version selects the highest remaining active version', () => {
  const versions = [
    { id: 'v1', versionNumber: 1, deletedAt: null },
    { id: 'v2', versionNumber: 2, deletedAt: new Date() },
    { id: 'v3', versionNumber: 3, deletedAt: null },
    { id: 'v4', versionNumber: 4, deletedAt: null },
  ];
  assert.equal(nextCurrentEightDVersion(versions, 'v4')?.id, 'v3');
  assert.equal(nextCurrentEightDVersion(versions, 'v3')?.id, 'v4');
  assert.equal(nextCurrentEightDVersion([{ id: 'v1', versionNumber: 1, deletedAt: null }], 'v1'), null);
});

test('8D migration persists independent product and issue many-to-many links', () => {
  assert.match(migration, /CREATE TABLE "eight_d_report_products"/);
  assert.match(migration, /PRIMARY KEY \("report_id", "drawing_library_item_id"\)/);
  assert.match(migration, /CREATE TABLE "eight_d_report_issues"/);
  assert.match(migration, /PRIMARY KEY \("report_id", "issue_id"\)/);
  assert.match(migration, /REFERENCES "drawing_library_items"\("id"\)/);
  assert.match(migration, /REFERENCES "issues"\("id"\)/);
  assert.match(schema, /model EightDReportProduct[\s\S]*?@@id\(\[reportId, drawingLibraryItemId\]\)/);
  assert.match(schema, /model EightDReportIssue[\s\S]*?@@id\(\[reportId, issueId\]\)/);
});

test('8D PDF versions use object keys, checksums, optimistic locking and soft deletion', () => {
  assert.match(migration, /"object_key" TEXT NOT NULL/);
  assert.match(migration, /"sha256" TEXT NOT NULL/);
  assert.match(migration, /"version" INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /"deleted_at" TIMESTAMP\(3\)/);
  assert.match(migration, /UNIQUE INDEX "eight_d_report_versions_report_id_version_number_key"/);
  assert.match(migration, /UNIQUE INDEX "eight_d_report_versions_report_id_sha256_key"/);
});

test('8D workbench is a PDF archive and association manager rather than a native 8D editor', () => {
  assert.match(component, /一份报告可关联多个产品和多个质量问题/);
  assert.match(component, /系统保存 PDF、版本和关联关系，不在此编辑 D1–D8 正文/);
  assert.match(component, /<PdfViewer/);
  assert.doesNotMatch(component, /鱼骨图|5\s*Why|D1表单|D2表单/);
});
