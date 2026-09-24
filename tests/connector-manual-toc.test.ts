import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractManualTocSuggestions } from '../lib/connector-manual-toc';

test('manual TOC accepts dotted and spaced leaders without changing page numbers', () => {
  const entries = extractManualTocSuggestions([
    'Assembly overview . . . 2',
    '安装方法 ．．． 3',
    'Safety instructions · … · 4',
    'Two dots .. 5',
    'Outside document ... 99',
    '1.2: Contact installation 6',
  ], 10);
  assert.deepEqual(entries.map(item => [item.title, item.pageStart]), [
    ['Assembly overview', 2], ['安装方法', 3], ['Safety instructions', 4], ['Contact installation', 6],
  ]);
});

test('long PDF leaders followed by text do not lock the browser thread', () => {
  const started = performance.now();
  const entries = extractManualTocSuggestions([
    `Safety ${'.'.repeat(80)} continued 2`,
    `Assembly ${' .'.repeat(40_000)} continued 3`,
    `连接器安装 ${'．·…'.repeat(20_000)} 4`,
    'Proper title ... 5',
  ], 10);
  assert.deepEqual(entries.map(item => [item.title, item.pageStart]), [['连接器安装', 4], ['Proper title', 5]]);
  assert.ok(performance.now() - started < 1000, 'TOC extraction must stay bounded for long PDF text');
});
