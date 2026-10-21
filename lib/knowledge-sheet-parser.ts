import * as XLSX from 'xlsx';
import type { PreviewSheet, SheetPage } from './knowledge-preview-types';

// The parser runs in a memory-limited worker. Reject excessive ranges explicitly;
// never show a clipped worksheet as if it were complete.
export function parseKnowledgeWorkbook(bytes: Uint8Array): PreviewSheet[] {
  const workbook = XLSX.read(bytes, { type: 'buffer', cellText: true, cellNF: true, cellStyles: true, cellFormula: true, sheetStubs: true });
  const result: PreviewSheet[] = [];
  let cells = 0, characters = 0;
  for (let i = 0; i < workbook.SheetNames.length; i++) {
    if (workbook.Workbook?.Sheets?.[i]?.Hidden) continue;
    const name = workbook.SheetNames[i];
    const sheet = workbook.Sheets[name];
    const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
    const columns = range ? range.e.c + 1 : 0;
    const rowCount = range ? range.e.r + 1 : 0;
    cells += columns * rowCount;
    if (columns > 256 || cells > 500_000 || result.length >= 50)
      throw new Error('表格超出在线表格预览范围（最多 50 个工作表、256 列、50 万个单元格），请使用版式预览或下载原件。');
    const rows: PreviewSheet['rows'] = [];
    for (let r = 0; r < rowCount; r++) {
      if (sheet['!rows']?.[r]?.hidden) continue;
      const values: string[] = [];
      for (let c = 0; c < columns; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        const value = !cell ? '' : cell.f && (cell.t === 'z' || cell.v === undefined || cell.v === null)
          ? '〔公式结果未保存〕' : cell.w ?? XLSX.utils.format_cell(cell);
        characters += value.length;
        if (characters > 12_000_000) throw new Error('表格文字量过大，请使用版式预览或下载原件。');
        values.push(value);
      }
      rows.push({ index: r + 1, cells: values });
    }
    const merges = (sheet['!merges'] || []).map(m => ({ r: m.s.r + 1, c: m.s.c, er: m.e.r + 1, ec: m.e.c }));
    // Repeat merged values in the data view so filtering/paging never loses their context.
    for (const merge of merges) {
      const anchor = sheet[XLSX.utils.encode_cell({ r: merge.r - 1, c: merge.c })];
      const value = anchor ? anchor.w ?? XLSX.utils.format_cell(anchor) : '';
      for (const row of rows) if (row.index >= merge.r && row.index <= merge.er) {
        for (let c = merge.c; c <= Math.min(merge.ec, columns - 1); c++) if (!row.cells[c]) row.cells[c] = value;
      }
    }
    result.push({ name, rowCount: rows.length, columnCount: columns,
      widths: Array.from({ length: columns }, (_, c) => Math.min(400, Math.max(110, (sheet['!cols']?.[c]?.wch || 16) * 8))), rows, merges });
  }
  if (!result.length) throw new Error('文件没有可见的工作表，请检查原文件。');
  return result;
}

export function paginateKnowledgeSheet(sheet: PreviewSheet, pageInput: number, queryInput = ''): SheetPage {
  const query = queryInput.trim().slice(0, 200);
  const rows = query ? sheet.rows.filter(row => row.cells.some(value => value.toLocaleLowerCase().includes(query.toLocaleLowerCase()))) : sheet.rows;
  const pageSize = Math.max(15, Math.min(150, Math.floor(4000 / Math.max(1, sheet.columnCount))));
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.max(1, Math.min(totalPages, Math.trunc(pageInput) || 1));
  return { name: sheet.name, rowCount: sheet.rowCount, columnCount: sheet.columnCount, widths: sheet.widths,
    rows: rows.slice((page - 1) * pageSize, page * pageSize), header: sheet.rows.find(row => row.index === 1) || null, merges: [], page, pageSize, totalRows: rows.length, totalPages, query };
}
