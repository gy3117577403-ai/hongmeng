import * as XLSX from "xlsx";
import { FixtureError, type BomCell, type BomSheet } from "@/lib/quality-fixture-domain";

export function readFixtureBom(buffer: Buffer, filename: string): BomSheet[] {
  if (!/\.(xlsx|xls)$/i.test(filename)) throw new FixtureError("BOM 仅支持 .xlsx / .xls");
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw new FixtureError("BOM 必须在 10 MB 以内");
  const zip = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const ole = buffer.subarray(0, 8).toString("hex") === "d0cf11e0a1b11ae1";
  if (!zip && !ole) throw new FixtureError("文件内容不是有效的 Excel 工作簿");
  let book: XLSX.WorkBook;
  try { book = XLSX.read(buffer, { type: "buffer", cellFormula: true, cellText: true, cellDates: false, bookVBA: false, sheetRows: 2002 }); }
  catch { throw new FixtureError("Excel 已损坏、被加密或无法读取，请重新导出"); }
  if (book.SheetNames.length > 20) throw new FixtureError("工作表超过 20 个，请拆分后上传");
  const sheets = book.SheetNames.map(name => {
    const sheet = book.Sheets[name];
    const range = XLSX.utils.decode_range(sheet["!fullref"] || sheet["!ref"] || "A1");
    if (range.e.r >= 2000 || range.e.c >= 80) throw new FixtureError(name + " 超过 2000 行或 80 列，请仅保留 BOM 区域");
    const rows: BomCell[][] = [];
    for (let r = 0; r <= range.e.r; r++) {
      const cells: BomCell[] = [];
      for (let c = 0; c <= range.e.c; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
        const text = cell ? String(cell.w ?? cell.v ?? "").trim() : "";
        if (text.length > 1000) throw new FixtureError(name + " 第 " + (r + 1) + " 行单元格过长");
        cells.push({ text, ...(cell?.f && (cell.v === undefined || cell.v === null) ? { error: "公式缺少缓存结果，须人工核对" } :
          cell?.t === "e" ? { error: "Excel 单元格错误，须人工核对" } :
          cell?.t === "n" && Math.abs(Number(cell.v)) >= 1e15 ? { error: "长数字可能丢失精度，请从原始文本核对型号" } : {}) });
      }
      rows.push(cells);
    }
    return { name, rows };
  });
  if (!sheets.length) throw new FixtureError("Excel 没有可读取工作表");
  return sheets;
}
