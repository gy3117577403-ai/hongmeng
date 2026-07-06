import { NextRequest, NextResponse } from 'next/server';
import {
  buildStandardWorkOrderPreview,
  buildWeeklyPlanPreview,
  findHeaderRow,
  inferWeekStartDateFromFilename,
  parseDelimitedWorkOrderText,
  standardWorkOrderHeaderNames,
  summarizeWorkOrderImport,
  weeklyPlanHeaderNames,
  type WorkOrderImportMode,
} from '@/lib/work-order-import';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ext } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ParsedFile = {
  rows: string[][];
  sheetName?: string | null;
};

function normalizeRows(rows: unknown[][]) {
  const normalized = rows.map(row => row.map(cell => String(cell ?? '').trim()));
  let last = normalized.length - 1;
  while (last >= 0 && !normalized[last].some(Boolean)) last -= 1;
  return normalized.slice(0, last + 1);
}

async function rowsFromFile(file: File): Promise<ParsedFile> {
  const extension = ext(file.name);
  if (extension === 'csv') {
    const text = new TextDecoder('utf-8').decode(await file.arrayBuffer());
    return { rows: parseDelimitedWorkOrderText(text) };
  }

  if (extension === 'xlsx' || extension === 'xls') {
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: 'buffer', cellStyles: false });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) return { rows: [], sheetName: null };
      const sheet = workbook.Sheets[sheetName];
      return {
        rows: normalizeRows(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: true }) as unknown[][]),
        sheetName,
      };
    } catch {
      throw new Error('Excel 文件读取失败');
    }
  }

  throw new Error('文件格式不支持，仅支持 .xls / .xlsx / .csv');
}

async function existingCodes() {
  const items = await prisma.workOrder.findMany({ select: { code: true } });
  return new Set(items.map(item => item.code));
}

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: '请选择导入文件' }, { status: 400 });

    const mode = (String(form.get('mode') || 'standard') === 'weekly_plan' ? 'weekly_plan' : 'standard') as WorkOrderImportMode;
    let parsed: ParsedFile;
    try {
      parsed = await rowsFromFile(file);
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : '导入文件解析失败' }, { status: 400 });
    }

    if (parsed.rows.length < 2) return NextResponse.json({ ok: false, error: '导入内容为空或缺少数据行' }, { status: 400 });

    const headerIndex = findHeaderRow(parsed.rows, mode);
    if (headerIndex < 0) {
      return NextResponse.json({
        ok: false,
        error: mode === 'weekly_plan' ? '表头缺失：未识别到周计划字段' : '表头缺失：未识别到工单导入字段',
      }, { status: 400 });
    }

    const headers = parsed.rows[headerIndex].map(header => header.trim());
    const knownHeaders = headers.filter(header => (mode === 'weekly_plan' ? weeklyPlanHeaderNames : standardWorkOrderHeaderNames).has(header));
    if (!knownHeaders.length) return NextResponse.json({ ok: false, error: '表头缺失或格式不支持' }, { status: 400 });

    const dataRows = parsed.rows.slice(headerIndex + 1);
    const codes = await existingCodes();
    const weekStartDate = String(form.get('weekStartDate') || inferWeekStartDateFromFilename(file.name)).trim();
    const rows = mode === 'weekly_plan'
      ? buildWeeklyPlanPreview({
        headers,
        rows: dataRows,
        startRowNo: headerIndex + 2,
        weekStartDate,
        sourceSheetName: parsed.sheetName || null,
        existingCodes: codes,
      })
      : buildStandardWorkOrderPreview({
        headers,
        rows: dataRows,
        startRowNo: headerIndex + 2,
        existingCodes: codes,
      });

    const warnings: string[] = [];
    if (mode === 'weekly_plan' && !weekStartDate) warnings.push('未设置计划周开始日期，plannedAt 将为空。');

    return NextResponse.json({
      ok: true,
      mode,
      sourceFileName: file.name,
      sourceSheetName: parsed.sheetName || null,
      weekStartDate,
      summary: summarizeWorkOrderImport(rows),
      rows,
      warnings,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '导入预览失败' }, { status: 500 });
  }
}
