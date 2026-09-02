import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SampleTaskPrintSheet from '../components/SampleTaskPrintSheet';
import {
  buildSamplePrintDocument,
  parseSamplePrintMode,
  samplePrintBackHref,
  samplePrintBaseUrl,
  samplePrintQrDataUrl,
  samplePrintRequestOrigin,
} from '../lib/sample-task-print';
import type { SampleDataEntryDTO, SampleTaskDTO } from '../types';

function entry(kind: SampleDataEntryDTO['kind'], payload: Record<string, unknown>, reviewStatus: SampleDataEntryDTO['reviewStatus'] = 'DRAFT', index = 1): SampleDataEntryDTO {
  return {
    id: `${kind}-${index}`,
    taskId: 'task-1',
    kind,
    label: null,
    payload,
    clientMutationId: null,
    submissionRevision: null,
    reviewStatus,
    publishMode: null,
    reviewComment: null,
    createdBy: null,
    updatedBy: null,
    reviewedBy: null,
    reviewedAt: null,
    publishedBy: null,
    publishedAt: null,
    publishedEntityType: null,
    publishedEntityId: null,
    version: 1,
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
  };
}

function task(entries: SampleDataEntryDTO[] = []): SampleTaskDTO {
  return {
    id: 'task-1',
    code: 'YP-20260902-ABC123',
    qrCode: 'opaque-qr-code',
    captureUrl: '/sample-capture/opaque-qr-code',
    drawingLibraryItemId: 'item-1',
    sourceOrderNo: 'SO-001',
    customerName: '杭州客户',
    productName: '线束样品',
    specification: 'EHPS-3-4G114-630',
    customerLevelCode: 'A',
    customerLevelLabel: 'A级',
    customerLevelColor: '#C9972E',
    sampleQuantity: 350,
    dueDate: '2026-09-07',
    priority: 2,
    status: 'IN_PROGRESS',
    dataStatus: entries.some(item => item.reviewStatus === 'CHANGES_REQUESTED')
      ? 'NEEDS_CHANGES'
      : entries.some(item => item.reviewStatus === 'PENDING')
        ? 'PENDING_REVIEW'
        : entries.length ? 'COLLECTING' : 'NO_DATA',
    planRemark: '拍照并核对工时',
    version: 1,
    submissionRevision: 0,
    activeSubmissionId: null,
    lastEditedKind: null,
    lastEditedRowId: null,
    activeSubmission: null,
    startedAt: null,
    submittedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdBy: '管理员',
    updatedBy: '管理员',
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    assignees: [{ id: 'a-1', employeeId: 'e-1', employeeNo: '001', name: '张三', team: '样品组', position: '技术员' }],
    sections: [],
    entries,
    photos: [],
    counts: { data: entries.length, photos: 0, pendingItems: 0, pendingReview: 0, changesRequested: 0, published: 0 },
  };
}

test('print base URL prefers APP_BASE_URL origin and falls back safely', () => {
  assert.equal(samplePrintBaseUrl('https://cn.example.com/app', 'http://proxy.local:3000'), 'https://cn.example.com');
  assert.equal(samplePrintBaseUrl('javascript:alert(1)', 'https://print.example.cn'), 'https://print.example.cn');
  assert.equal(samplePrintBaseUrl('https://user:secret@example.com', 'http://localhost:3000'), 'http://localhost:3000');
  assert.equal(samplePrintBaseUrl('https://evil.example\r\nX-Test: injected', 'http://localhost:3000'), 'http://localhost:3000');
  assert.equal(samplePrintRequestOrigin(new Headers({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'sample.example.cn:443' })), 'https://sample.example.cn:443');
  assert.equal(samplePrintRequestOrigin(new Headers({ host: 'bad/path' })), undefined);
});

test('print mode and return path reject unknown query values', () => {
  assert.equal(parseSamplePrintMode('blank'), 'blank');
  assert.equal(parseSamplePrintMode('other'), 'current');
  assert.equal(samplePrintBackHref('execution'), '/production?branch=samples');
  assert.equal(samplePrintBackHref('materials'), '/workspace/warehouse?branch=samples');
  assert.equal(samplePrintBackHref('https://evil.example'), '/weekly-plan-center?branch=samples');
});

test('current print normalizes historic material fields and filters voided records', () => {
  const document = buildSamplePrintDocument(task([
    entry('PROCESS_TIME', { processName: '裁线', recommendedSeconds: 12.5 }),
    entry('STRIPPING', { model: '630', outerPeelMm: 4, innerPeelMm: 2, insertionLengthMm: 18 }),
    entry('MATERIAL', { name: '热缩管', model: 'Φ8 黑色', lengthMm: 36, quantity: 2, unit: '根' }),
    entry('NOTICE', { category: '安全', severity: '重要', content: '不得压伤护套' }, 'CHANGES_REQUESTED'),
    entry('MATERIAL', { name: '不应出现' }, 'VOIDED', 2),
  ]), { mode: 'current', baseUrl: 'https://sample.example.cn', printedAt: new Date('2026-09-02T02:30:00Z'), printedBy: '测试员' });

  assert.equal(document.captureUrl, 'https://sample.example.cn/sample-capture/opaque-qr-code');
  assert.equal(document.stateLabel, '待修改');
  assert.equal(document.pages.length, 1);
  assert.deepEqual(document.pages[0].sections[0].rows[0].cells, ['裁线', '12.5']);
  assert.deepEqual(document.pages[0].sections[2].rows[0].cells, ['热缩管', 'Φ8 黑色', '36', '2 根', '']);
  assert.equal(document.pages[0].sections[2].rows.some(row => row.cells.includes('不应出现')), false);
  assert.equal(document.pages[0].sections[0].rows.length, 5);
  assert.equal(document.pages[0].sections[1].rows.length, 1);
  assert.equal(document.pages[0].sections[2].rows.length, 6);
  assert.equal(document.pages[0].sections[3].rows.length, 4);
});

test('blank mode never includes server records and excess current rows create continuation pages', () => {
  const entries = Array.from({ length: 24 }, (_, index) => entry('PROCESS_TIME', { processName: `工序 ${index + 1}`, recommendedSeconds: index + 1 }, 'DRAFT', index + 1));
  const current = buildSamplePrintDocument(task(entries), { mode: 'current', baseUrl: 'https://sample.example.cn' });
  const blank = buildSamplePrintDocument(task(entries), { mode: 'blank', baseUrl: 'https://sample.example.cn' });
  assert.equal(current.pages.length, 3);
  assert.equal(current.pages[0].sections[0].rows.length, 5);
  assert.equal(current.pages[1].sections[0].rows.length, 18);
  assert.equal(current.pages[2].sections[0].rows.length, 1);
  assert.equal(blank.pages.length, 1);
  assert.equal(blank.pages[0].sections.flatMap(section => section.rows).every(row => row.blank), true);
});

test('server draft sections are authoritative for process and stripping print rows', () => {
  const source = task([
    entry('PROCESS_TIME', { processName: '旧工序', recommendedSeconds: 99 }),
    entry('STRIPPING', { model: '旧型号', outerPeelMm: 9 }),
  ]);
  source.sections = [
    {
      id: 'section-process', taskId: source.id, kind: 'PROCESS_TIME', schemaVersion: 1, revision: 2,
      payload: { rows: [
        { rowId: 'p1', position: 0, processName: '新裁线', processOrigin: 'MASTER', measuredMilliseconds: 12_500 },
        { rowId: 'p2', position: 1, processName: '', processOrigin: 'PROPOSED', measuredMilliseconds: null },
      ] },
      uiState: {}, updatedBy: '测试员', createdAt: source.createdAt, updatedAt: source.updatedAt,
    },
    {
      id: 'section-strip', taskId: source.id, kind: 'STRIPPING', schemaVersion: 1, revision: 1,
      payload: { rows: [{ rowId: 's1', position: 0, model: '新型号', outerPeelMm: '4.2', innerPeelMm: '2', insertionLengthMm: '18' }] },
      uiState: {}, updatedBy: '测试员', createdAt: source.createdAt, updatedAt: source.updatedAt,
    },
  ];
  source.dataStatus = 'COLLECTING';
  const document = buildSamplePrintDocument(source, { mode: 'current', baseUrl: 'https://sample.example.cn' });
  assert.deepEqual(document.pages[0].sections[0].rows[0].cells, ['新裁线', '12.5']);
  assert.deepEqual(document.pages[0].sections[1].rows[0].cells, ['新型号', '4.2', '2', '18']);
  assert.equal(document.pages[0].sections[0].rows.some(row => row.cells.includes('旧工序')), false);
  assert.equal(document.pages[0].sections[1].rows.some(row => row.cells.includes('旧型号')), false);
  assert.equal(document.stateLabel, '草稿');
});

test('print sheet uses React escaping and never injects user HTML', () => {
  const hostile = task([entry('NOTICE', { category: '<img src=x onerror=alert(1)>', content: '<script>alert(1)</script>' })]);
  hostile.planRemark = '<svg onload=alert(1)>';
  const document = buildSamplePrintDocument(hostile, { mode: 'current', baseUrl: 'https://sample.example.cn' });
  const html = renderToStaticMarkup(React.createElement(SampleTaskPrintSheet, { document, qrDataUrl: 'data:image/png;base64,AA==' }));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;svg onload=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<script>|<svg onload=|<img src=x/);
  const source = readFileSync('components/SampleTaskPrintSheet.tsx', 'utf8');
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
});

test('QR output is high resolution with a four-module quiet zone contract', async () => {
  const value = await samplePrintQrDataUrl('https://sample.example.cn/sample-capture/opaque-qr-code');
  assert.match(value, /^data:image\/png;base64,/);
  assert.ok(value.length > 5_000);
  const source = readFileSync('lib/sample-task-print.ts', 'utf8');
  assert.match(source, /errorCorrectionLevel:\s*'Q'/);
  assert.match(source, /margin:\s*4/);
  assert.match(source, /width:\s*1024/);
});

test('print route is authenticated, private-dynamic and modal exposes print action', () => {
  const page = readFileSync('app/sample-print/[id]/page.tsx', 'utf8');
  const center = readFileSync('components/SampleTeamCenter.tsx', 'utf8');
  const css = readFileSync('app/sample-print/sample-print.css', 'utf8');
  assert.match(page, /requirePageAccess\('\/sample-capture'/);
  assert.match(page, /unstable_noStore/);
  assert.match(page, /dynamic\s*=\s*'force-dynamic'/);
  assert.match(center, /打印标准采集单/);
  assert.match(css, /@page\s*\{\s*size:\s*A4 portrait;\s*margin:\s*10mm;/);
  assert.match(css, /\[data-print-hidden\]\s*\{\s*display:\s*none !important/);
  assert.match(css, /break-inside:\s*avoid/);
});
