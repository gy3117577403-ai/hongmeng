import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import { parseKnowledgeWorkbook, paginateKnowledgeSheet } from '../lib/knowledge-sheet-parser';
import { resolveAccessContext } from '../lib/department-access';
import { canAccessApiRoute } from '../lib/api-route-access';

function bytes(sheet: XLSX.WorkSheet, type: 'xlsx' | 'xls' = 'xlsx') {
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, '物料配套');
  return XLSX.write(book, { type: 'buffer', bookType: type });
}
for (const type of ['xls', 'xlsx'] as const) test(`${type} preview preserves formatted codes, long text, dates and saved formulas`, () => {
  const sheet = XLSX.utils.aoa_to_sheet([['型号', '长编码', '日期', '数量', '公式'], [123, '12345678901234567890', 45951, 5, 10]]);
  sheet.A2.z = '000000'; sheet.C2.z = 'yyyy-mm-dd'; sheet.E2.f = 'D2*2';
  const result = parseKnowledgeWorkbook(bytes(sheet, type))[0];
  assert.equal(result.rows[1].cells[0], '000123'); assert.equal(result.rows[1].cells[1], '12345678901234567890');
  assert.match(result.rows[1].cells[2], /^\d{4}-\d{2}-\d{2}$/); assert.equal(result.rows[1].cells[4], '10');
});
test('real legacy office fixtures parse as spreadsheets', () => {
  for (const type of ['xls', 'xlsx']) assert.ok(parseKnowledgeWorkbook(readFileSync(new URL(`./fixtures/knowledge-office/knowledge.${type}`, import.meta.url)))[0].rows.length);
});
test('missing formula cache is explicit, hidden sheets stay hidden and merged context survives paging', () => {
  const sheet = XLSX.utils.aoa_to_sheet([['型号', '数量'], ...Array.from({ length: 310 }, (_, i) => [i === 0 ? 'HVSL-001' : '', i])]);
  sheet.C1 = { t: 'n', f: '1+2' }; sheet['!ref'] = 'A1:C311';
  sheet['!merges'] = [{ s: { r: 1, c: 0 }, e: { r: 310, c: 0 } }];
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, '可见表'); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['hidden']]), '隐藏表');
  book.Workbook = { Sheets: [{ name: '可见表', Hidden: 0 }, { name: '隐藏表', Hidden: 1 }] };
  const parsed = parseKnowledgeWorkbook(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
  assert.equal(parsed.length, 1); assert.equal(parsed[0].rows[0].cells[2], '〔公式结果未保存〕');
  const page = paginateKnowledgeSheet(parsed[0], 2); assert.equal(page.rows[0].cells[0], 'HVSL-001');
  assert.equal(paginateKnowledgeSheet(parsed[0], 1, 'hvsl').totalRows, 310);
  assert.equal(paginateKnowledgeSheet(parsed[0], 999).rows.at(-1)?.index, 311);
  assert.equal(paginateKnowledgeSheet(parsed[0], 1, '<script>').totalRows, 0);
});
test('format-only tails do not enlarge the effective table; real far cells remain accessible', () => {
  const sheet = XLSX.utils.aoa_to_sheet([['型号', '数量'], ['000123', 5]]); sheet['!ref'] = 'A1:XFD2982';
  const parsed = parseKnowledgeWorkbook(bytes(sheet))[0];
  assert.equal(parsed.columnCount, 2); assert.equal(parsed.rowCount, 2); assert.equal(parsed.nonEmptyCells, 4);
  sheet.XFD2982 = { t: 's', v: '末列真实资料' };
  const wide = parseKnowledgeWorkbook(bytes(sheet))[0];
  assert.equal(wide.columnCount, 16384);
  const end = paginateKnowledgeSheet(wide, 1, '末列真实资料', 16383);
  assert.equal(end.totalRows, 1); assert.equal(end.rows[0].index, 2982);
  assert.equal(end.rows[0].cells[16383 - end.columnOffset], '末列真实资料');
  assert.ok(end.visibleColumns <= 40);
});
test('more than fifty worksheets and hidden rows do not prevent other sheets being read', () => {
  const book = XLSX.utils.book_new();
  for (let i = 0; i < 55; i++) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[`页${i}`], ['隐藏'], ['末行']]), `表${i}`);
  book.Sheets['表54']['!rows'] = [{}, { hidden: true }];
  const sheets = parseKnowledgeWorkbook(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
  assert.equal(sheets.length, 55);
  assert.equal(paginateKnowledgeSheet(sheets[54], 1, '隐藏').totalRows, 0);
  assert.deepEqual(paginateKnowledgeSheet(sheets[54], 1).rows.map(r => r.index), [1, 3]);
});
test('knowledge readers can preview and retry without acquiring edit permission', () => {
  const reader = resolveAccessContext([
    { profile: 'MODULE_ACCESS', grantType: 'PRIMARY', scopeKey: 'MODULES:ON' },
    { profile: 'MODULE_ACCESS', grantType: 'CONCURRENT', scopeKey: 'MODULE:knowledge:READ' },
  ]);
  for (const method of ['GET', 'POST']) assert.equal(canAccessApiRoute(reader, '/api/knowledge/attachments/a/preview', method), true);
  assert.equal(canAccessApiRoute(reader, '/api/knowledge/attachments/a/preview/pdf', 'GET'), true);
  assert.equal(canAccessApiRoute(reader, '/api/knowledge/attachments/a/preview/table', 'GET'), true);
  assert.equal(canAccessApiRoute(reader, '/api/knowledge/attachments/a', 'DELETE'), false);
});
