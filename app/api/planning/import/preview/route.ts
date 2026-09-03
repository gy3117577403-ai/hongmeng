import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ext } from '@/lib/validation';
import { chinaDate, editableProductionPlanningWeek } from '@/lib/production-planning';
import {
  buildProductionPlanImportRows,
  findProductionPlanImportHeaderRow,
  PRODUCTION_PLAN_IMPORT_MAX_ROWS,
  productionPlanImportPreviewToken,
  summarizeProductionPlanImport,
  type ProductionPlanImportCandidate,
  type ProductionPlanImportExistingOrder,
} from '@/lib/production-plan-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ParsedFile = { rows: string[][]; sheetName: string | null; bytes: Buffer };

function normalizeRows(rows: unknown[][]): string[][] {
  const normalized = rows.map(row => row.map(cell => String(cell ?? '').trim()));
  let last = normalized.length - 1;
  while (last >= 0 && !normalized[last].some(Boolean)) last -= 1;
  return normalized.slice(0, last + 1);
}

function parseDelimited(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '').trim();
  if (!source) return [];
  const lines = source.split(/\r?\n/);
  const delimiter = (lines[0] || '').includes('\t') ? '\t' : ',';
  if (delimiter === '\t') return lines.map(line => line.split('\t').map(cell => cell.trim()));
  return lines.map(line => {
    const cells: string[] = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"' && line[index + 1] === '"' && quoted) { value += '"'; index += 1; continue; }
      if (char === '"') { quoted = !quoted; continue; }
      if (char === ',' && !quoted) { cells.push(value.trim()); value = ''; continue; }
      value += char;
    }
    cells.push(value.trim());
    return cells;
  });
}

async function parseFile(file: File): Promise<ParsedFile> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const extension = ext(file.name);
  if (extension === 'csv') {
    return { rows: parseDelimited(new TextDecoder('utf-8').decode(bytes)), sheetName: null, bytes };
  }
  if (extension !== 'xlsx' && extension !== 'xls') throw new Error('仅支持 .xlsx、.xls 或 .csv 文件');
  try {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(bytes, { type: 'buffer', cellStyles: false });
    const sheetName = workbook.SheetNames[0] || null;
    if (!sheetName) return { rows: [], sheetName: null, bytes };
    return {
      rows: normalizeRows(XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1, defval: '', raw: false, blankrows: true,
      }) as unknown[][]),
      sheetName,
      bytes,
    };
  } catch {
    throw new Error('Excel 文件读取失败，请重新下载模板后填写');
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: '请选择导入文件' }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ ok: false, error: '导入文件不能超过 10MB' }, { status: 413 });
    const targetWeek = editableProductionPlanningWeek(String(form.get('weekStartDate') || ''));
    if (!targetWeek) return NextResponse.json({ ok: false, error: '导入目标只能是当前起未来 12 周内的生产周' }, { status: 400 });

    let parsed: ParsedFile;
    try { parsed = await parseFile(file); }
    catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : '文件解析失败' }, { status: 400 }); }
    const headerIndex = findProductionPlanImportHeaderRow(parsed.rows);
    if (headerIndex < 0) {
      return NextResponse.json({ ok: false, error: '表头不完整，请下载新版“量产计划批量导入模板”后填写' }, { status: 400 });
    }
    const dataRows = parsed.rows.slice(headerIndex + 1);
    if (!dataRows.length) return NextResponse.json({ ok: false, error: '模板中没有可读取的数据行' }, { status: 400 });
    if (dataRows.length > PRODUCTION_PLAN_IMPORT_MAX_ROWS) {
      return NextResponse.json({ ok: false, error: `单次最多导入 ${PRODUCTION_PLAN_IMPORT_MAX_ROWS} 行，请拆分文件后重试` }, { status: 400 });
    }

    const targetWeekStartDate = chinaDate(targetWeek.start);
    const targetWeekEndDate = chinaDate(targetWeek.end);
    const preliminaryRows = buildProductionPlanImportRows({
      headers: parsed.rows[headerIndex],
      rows: dataRows,
      startRowNo: headerIndex + 2,
      targetWeekStartDate,
      targetWeekEndDate,
      libraryItems: [],
      existingOrders: [],
    });
    const sourceOrderNumbers = [...new Set(preliminaryRows.flatMap(row => row.input?.sourceOrderNo ? [row.input.sourceOrderNo] : []))];
    const [libraryRecords, orderRecords] = await Promise.all([
      prisma.drawingLibraryItem.findMany({
        select: {
          id: true, libraryKey: true, customerName: true, productName: true, specification: true, deletedAt: true,
          _count: {
            select: {
              files: { where: { deletedAt: null, isCurrent: true, category: { code: 'drawing' } } },
            },
          },
          files: {
            where: { deletedAt: null, isCurrent: true, category: { code: 'sop' } },
            select: { id: true }, take: 1,
          },
          productTimeProfiles: {
            where: { status: 'published' }, orderBy: { version: 'desc' }, select: { version: true }, take: 1,
          },
        },
      }),
      prisma.productionPlanOrder.findMany({
        where: sourceOrderNumbers.length ? { sourceOrderNo: { in: sourceOrderNumbers } } : { id: '__none__' },
        select: {
          id: true, sourceOrderNo: true, sourceLineNo: true, drawingLibraryItemId: true,
          customerDueDate: true, status: true, deletedAt: true,
          batches: { where: { deletedAt: null }, select: { weekStartDate: true } },
        },
      }),
    ]);
    const libraryItems: ProductionPlanImportCandidate[] = libraryRecords.map(item => ({
      id: item.id,
      libraryKey: item.libraryKey,
      customerName: item.customerName,
      productName: item.productName,
      specification: item.specification,
      deletedAt: item.deletedAt?.toISOString() || null,
      drawingFileCount: item._count.files,
      sopFileCount: item.files.length,
      productTimeVersion: item.productTimeProfiles[0]?.version || null,
    }));
    const existingOrders: ProductionPlanImportExistingOrder[] = orderRecords.map(order => ({
      id: order.id,
      sourceOrderNo: order.sourceOrderNo,
      sourceLineNo: order.sourceLineNo,
      drawingLibraryItemId: order.drawingLibraryItemId,
      customerDueDate: chinaDate(order.customerDueDate),
      status: order.status,
      deletedAt: order.deletedAt?.toISOString() || null,
      batchWeekStartDates: order.batches.map(batch => chinaDate(batch.weekStartDate)),
    }));
    const rows = buildProductionPlanImportRows({
      headers: parsed.rows[headerIndex],
      rows: dataRows,
      startRowNo: headerIndex + 2,
      targetWeekStartDate,
      targetWeekEndDate,
      libraryItems,
      existingOrders,
    });
    const sourceFileHash = createHash('sha256').update(parsed.bytes).digest('hex');
    const previewToken = productionPlanImportPreviewToken({ sourceFileHash, targetWeekStartDate, targetWeekEndDate, rows });
    const requestId = randomUUID();
    const summary = summarizeProductionPlanImport(rows);
    const previewData = { rows, summary };
    const batch = await prisma.productionPlanImportBatch.create({
      data: {
        requestId,
        previewToken,
        sourceFileName: file.name.slice(0, 180),
        sourceSheetName: parsed.sheetName?.slice(0, 160) || null,
        sourceFileHash,
        targetWeekStartDate: targetWeek.start,
        targetWeekEndDate: targetWeek.end,
        previewData: previewData as unknown as Prisma.InputJsonValue,
        createdById: user.id,
      },
      select: { id: true },
    });
    return NextResponse.json({
      ok: true,
      batchId: batch.id,
      requestId,
      previewToken,
      sourceFileName: file.name,
      sourceSheetName: parsed.sheetName,
      targetWeekStartDate,
      targetWeekEndDate,
      summary,
      rows,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('production plan import preview failed', error);
    return NextResponse.json({ ok: false, error: '量产计划导入预检失败' }, { status: 500 });
  }
}
