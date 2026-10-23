import * as XLSX from 'xlsx';
import type { PreviewSheet, SheetPage } from './knowledge-preview-types';

/** Store actual values only. A formatting-only !ref is never a memory allocation size. */
export function parseKnowledgeWorkbook(bytes: Uint8Array): PreviewSheet[] {
  const workbook = XLSX.read(bytes, { type: 'buffer', cellText: true, cellNF: true, cellStyles: true, cellFormula: true, sheetStubs: false });
  const result: PreviewSheet[] = [];
  for (let i = 0; i < workbook.SheetNames.length; i++) {
    if (workbook.Workbook?.Sheets?.[i]?.Hidden) continue;
    const name = workbook.SheetNames[i], sheet = workbook.Sheets[name];
    try {
      const rows = new Map<number, Record<number, string>>();
      let firstRow = Infinity, lastRow = 0, firstColumn = Infinity, columns = 0, cells = 0, characters = 0;
      for (const address of Object.keys(sheet)) {
        if (!/^[A-Z]+[1-9][0-9]*$/.test(address)) continue;
        const cell = sheet[address];
        if (!cell || (!cell.f && (cell.v === undefined || cell.v === null || cell.v === ''))) continue;
        const at = XLSX.utils.decode_cell(address);
        if (sheet['!rows']?.[at.r]?.hidden) continue;
        const value = cell.f && (cell.t === 'z' || cell.v === undefined || cell.v === null) ? '〔公式结果未保存〕' : cell.w ?? XLSX.utils.format_cell(cell);
        if (!value) continue;
        cells++; characters += value.length;
        if (cells > 500_000 || characters > 12_000_000) throw Error(`本工作表有效内容超过处理范围（已读取 ${cells} 个有值单元格、${characters} 个字符）；其他工作表仍可查看。`);
        const row = rows.get(at.r + 1) || {};
        row[at.c] = value; rows.set(at.r + 1, row);
        firstRow = Math.min(firstRow, at.r + 1); lastRow = Math.max(lastRow, at.r + 1);
        firstColumn = Math.min(firstColumn, at.c); columns = Math.max(columns, at.c + 1);
      }
      const merges: PreviewSheet['merges'] = [];
      for (const m of sheet['!merges'] || []) {
        const value = rows.get(m.s.r + 1)?.[m.s.c];
        if (!value) continue;
        merges.push({ r: m.s.r + 1, c: m.s.c, er: m.e.r + 1, ec: m.e.c, value });
        lastRow = Math.max(lastRow, m.e.r + 1); columns = Math.max(columns, m.e.c + 1);
      }
      const hiddenRows = Object.entries(sheet['!rows'] || {}).filter(([, row]) => row.hidden).map(([n]) => Number(n) + 1).filter(n => n >= firstRow && n <= lastRow).sort((a,b) => a-b);
      result.push({ name, rowCount: lastRow ? lastRow - firstRow + 1 - hiddenRows.length : 0, columnCount: columns,
        firstRow: Number.isFinite(firstRow) ? firstRow : 1, lastRow, firstColumn: Number.isFinite(firstColumn) ? firstColumn : 0, nonEmptyCells: cells,
        widths: Array.from({ length: columns }, (_, c) => Math.min(400, Math.max(110, (sheet['!cols']?.[c]?.wch || 16) * 8))),
        rows: [...rows].sort(([a],[b]) => a-b).map(([index, values]) => ({ index, cells: values })), hiddenRows, merges });
    } catch (error) {
      result.push({ name, rowCount: 0, columnCount: 0, widths: [], rows: [], merges: [], error: error instanceof Error && error.message.startsWith('本工作表') ? error.message : '本工作表无法解析；其他工作表仍可查看。' });
    }
  }
  if (!result.length) throw new Error('文件没有可见的工作表，请检查原文件。');
  return result;
}

/** Intervals preserve blank rows and merged search matches without expanding a million rows. */
export function knowledgeRowRanges(sheet: PreviewSheet, query: string): [number, number][] {
  const q = query.trim().toLocaleLowerCase();
  const spans: [number, number][] = q ? [
    ...sheet.rows.filter(row => Object.values(row.cells).some(v => v.toLocaleLowerCase().includes(q))).map(row => [row.index, row.index] as [number, number]),
    ...sheet.merges.filter(m => m.value?.toLocaleLowerCase().includes(q)).map(m => [m.r, m.er] as [number, number]),
  ] : sheet.rowCount ? [[sheet.firstRow || 1, sheet.lastRow || sheet.rowCount]] : [];
  const merged: [number, number][] = [];
  for (const span of spans.sort((a,b) => a[0]-b[0])) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1] + 1) last[1] = Math.max(last[1], span[1]); else merged.push([...span]);
  }
  const visible: [number, number][] = [];
  for (const [start, end] of merged) {
    let cursor = start;
    for (const hidden of sheet.hiddenRows || []) { if (hidden < cursor) continue; if (hidden > end) break; if (hidden > cursor) visible.push([cursor, hidden-1]); cursor = hidden+1; }
    if (cursor <= end) visible.push([cursor, end]);
  }
  return visible;
}

export function paginateKnowledgeSheet(sheet: PreviewSheet, pageInput: number, queryInput = '', columnInput?: number, suppliedRanges?: [number, number][]): SheetPage {
  const query = queryInput.trim().slice(0, 200);
  const ranges = suppliedRanges || knowledgeRowRanges(sheet, query);
  const totalRows = ranges.reduce((n,[a,b]) => n+b-a+1,0), pageSize = 100;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const page = Math.max(1, Math.min(totalPages, Math.trunc(pageInput) || 1));
  const columnOffset = Math.max(sheet.firstColumn || 0, Math.min(Math.max(0, sheet.columnCount-1), Number.isFinite(columnInput) ? Math.trunc(columnInput!) : sheet.firstColumn || 0));
  const visibleColumns = Math.min(40, Math.max(0, sheet.columnCount - columnOffset));
  const values = new Map(sheet.rows.map(r => [r.index, r.cells]));
  const row = (index: number) => ({ index, cells: Array.from({ length: visibleColumns }, (_, i) => {
    const col = columnOffset+i;
    return values.get(index)?.[col] || sheet.merges.find(m => index >= m.r && index <= m.er && col >= m.c && col <= m.ec)?.value || '';
  }) });
  const rows: SheetPage['rows'] = []; let skip = (page-1)*pageSize;
  for (const [start,end] of ranges) {
    if (skip >= end-start+1) { skip -= end-start+1; continue; }
    for (let index = start+skip; index <= end && rows.length < pageSize; index++) rows.push(row(index));
    skip = 0; if (rows.length >= pageSize) break;
  }
  const metadata = { name: sheet.name, rowCount: sheet.rowCount, columnCount: sheet.columnCount, widths: sheet.widths,
    firstRow: sheet.firstRow, lastRow: sheet.lastRow, firstColumn: sheet.firstColumn, nonEmptyCells: sheet.nonEmptyCells, error: sheet.error };
  return { ...metadata, rows, header: sheet.rowCount ? row(sheet.firstRow || 1) : null, merges: [], page, pageSize, totalRows, totalPages, query, columnOffset, visibleColumns };
}
