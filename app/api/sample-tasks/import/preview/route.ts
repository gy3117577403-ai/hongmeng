import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { chinaDateKey } from '@/lib/china-date';
import { drawingLibraryKey } from '@/lib/drawing-library';
import { prisma } from '@/lib/prisma';
import {
  SAMPLE_PLAN_IMPORT_HEADERS,
  cleanImportText,
  findSamplePlanHeaderRow,
  parsePositiveInteger,
  parseSamplePlanDate,
  parseSamplePlanRow,
  samplePlanFingerprint,
  sampleSpecificationSimilarity,
  type SamplePlanImportRow,
} from '@/lib/sample-plan-import';
import { sampleCustomerLevel } from '@/lib/sample-customer-levels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_IMPORT_ROWS = 500;
const MAX_FILE_BYTES = 12 * 1024 * 1024;

function blockedRow(raw: unknown[], rowNumber: number, columns: Record<string, number>, message: string): SamplePlanImportRow {
  const value = (header: (typeof SAMPLE_PLAN_IMPORT_HEADERS)[number]) => raw[columns[header]];
  return {
    rowNumber,
    customerName: cleanImportText(value('客户名称')),
    productName: cleanImportText(value('产品名称')),
    specification: cleanImportText(value('型号/规格')),
    customerLevelCode: sampleCustomerLevel(value('客户等级'))?.code || cleanImportText(value('客户等级'), 10).toUpperCase(),
    sampleQuantity: parsePositiveInteger(value('样品数量')) || 0,
    dueDate: parseSamplePlanDate(value('计划日期')) || cleanImportText(value('计划日期'), 40),
    libraryKey: Number.isInteger(columns['图纸库编号（选填）']) ? cleanImportText(value('图纸库编号（选填）'), 240) : '',
    matchStatus: 'BLOCKED',
    message,
    matchedItemId: null,
    candidates: [],
  };
}

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: '请选择 Excel 文件' }, { status: 400 });
    if (!file.name.toLowerCase().endsWith('.xlsx')) return NextResponse.json({ ok: false, error: '只支持 .xlsx 模板文件' }, { status: 400 });
    if (!file.size || file.size > MAX_FILE_BYTES) return NextResponse.json({ ok: false, error: 'Excel 文件不能为空且不能超过 12MB' }, { status: 400 });

    let rows: unknown[][];
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = firstSheet ? XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, raw: true, defval: null }) : [];
    } catch {
      return NextResponse.json({ ok: false, error: 'Excel 文件无法读取，请重新下载模板后填写' }, { status: 400 });
    }
    const header = findSamplePlanHeaderRow(rows);
    if (!header) return NextResponse.json({ ok: false, error: '未找到模板表头，请勿修改前 6 列列名' }, { status: 400 });

    const parsedRows: SamplePlanImportRow[] = [];
    const candidatesForMatch: Array<Omit<SamplePlanImportRow, 'matchStatus' | 'message' | 'matchedItemId' | 'candidates'>> = [];
    for (let index = header.index + 1; index < rows.length; index += 1) {
      const raw = rows[index] || [];
      const nonBlank = raw.some(value => cleanImportText(value, 10));
      if (!nonBlank) continue;
      if (parsedRows.length + candidatesForMatch.length >= MAX_IMPORT_ROWS) {
        return NextResponse.json({ ok: false, error: `每次最多导入 ${MAX_IMPORT_ROWS} 行有效数据` }, { status: 400 });
      }
      const parsed = parseSamplePlanRow(raw, index + 1, header.columns);
      if (!parsed.row) parsedRows.push(blockedRow(raw, index + 1, header.columns, parsed.errors.join('；') || '该行没有可导入数据'));
      else candidatesForMatch.push(parsed.row);
    }
    if (!parsedRows.length && !candidatesForMatch.length) return NextResponse.json({ ok: false, error: '模板中没有待导入数据' }, { status: 400 });

    const requestedKeys = candidatesForMatch.map(row => row.libraryKey).filter(Boolean);
    const exactKeys = candidatesForMatch.map(row => drawingLibraryKey(row.customerName, row.specification));
    const customerNames = [...new Set(candidatesForMatch.map(row => row.customerName))];
    const drawingItems = await prisma.drawingLibraryItem.findMany({
      where: {
        OR: [
          { id: { in: requestedKeys } },
          { libraryKey: { in: [...requestedKeys, ...exactKeys] } },
          { customerName: { in: customerNames }, deletedAt: null },
        ],
      },
      select: { id: true, libraryKey: true, customerName: true, productName: true, specification: true, deletedAt: true },
      take: 3000,
    });
    const byId = new Map(drawingItems.map(item => [item.id, item]));
    const byKey = new Map(drawingItems.map(item => [item.libraryKey.toLocaleLowerCase('zh-CN'), item]));
    const duplicateFingerprints = new Set<string>();
    const matchedRows: SamplePlanImportRow[] = [];

    for (const row of candidatesForMatch) {
      const fingerprint = samplePlanFingerprint(row);
      if (duplicateFingerprints.has(fingerprint)) {
        matchedRows.push({ ...row, matchStatus: 'BLOCKED', message: '文件内存在重复计划，本行已阻止导入', matchedItemId: null, candidates: [] });
        continue;
      }
      duplicateFingerprints.add(fingerprint);
      if (row.libraryKey) {
        const precise = byId.get(row.libraryKey) || byKey.get(row.libraryKey.toLocaleLowerCase('zh-CN'));
        matchedRows.push(precise
          ? { ...row, matchStatus: 'REUSE', message: precise.deletedAt ? '精确匹配到已归档图纸库，导入时将恢复并复用' : '已按图纸库编号精确匹配', matchedItemId: precise.id, candidates: [] }
          : { ...row, matchStatus: 'BLOCKED', message: '填写的图纸库编号不存在，请清空后自动匹配或改为正确编号', matchedItemId: null, candidates: [] });
        continue;
      }
      const exactKey = drawingLibraryKey(row.customerName, row.specification).toLocaleLowerCase('zh-CN');
      const exact = byKey.get(exactKey);
      if (exact) {
        matchedRows.push({ ...row, matchStatus: 'REUSE', message: exact.deletedAt ? '匹配到已归档图纸库，导入时将恢复并复用' : '客户与型号/规格唯一匹配，直接复用图纸库', matchedItemId: exact.id, candidates: [] });
        continue;
      }
      const similar = drawingItems
        .filter(item => !item.deletedAt && item.customerName.trim().toLocaleLowerCase('zh-CN') === row.customerName.trim().toLocaleLowerCase('zh-CN'))
        .map(item => ({ ...item, score: sampleSpecificationSimilarity(row.specification, item.specification) }))
        .filter(item => item.score >= 0.56)
        .sort((left, right) => right.score - left.score)
        .slice(0, 3)
        .map(({ deletedAt: _deletedAt, ...item }) => item);
      matchedRows.push(similar.length
        ? { ...row, matchStatus: 'CONFIRM', message: '发现相似图纸库，请人工选择复用或明确新建', matchedItemId: null, candidates: similar }
        : { ...row, matchStatus: 'CREATE', message: '未匹配到图纸库，导入时自动新建', matchedItemId: null, candidates: [] });
    }

    const matchedItemIds = matchedRows.map(row => row.matchedItemId).filter((value): value is string => Boolean(value));
    const existingTasks = matchedItemIds.length ? await prisma.sampleTask.findMany({
      where: { drawingLibraryItemId: { in: matchedItemIds }, deletedAt: null, status: { not: 'CANCELLED' } },
      select: { id: true, code: true, drawingLibraryItemId: true, customerLevelCode: true, sampleQuantity: true, dueDate: true },
    }) : [];
    const finalRows = [...parsedRows, ...matchedRows.map(row => {
      if (!row.matchedItemId || row.matchStatus !== 'REUSE') return row;
      const duplicate = existingTasks.find(task => task.drawingLibraryItemId === row.matchedItemId
        && (task.customerLevelCode || '').toUpperCase() === row.customerLevelCode
        && task.sampleQuantity === row.sampleQuantity
        && task.dueDate && chinaDateKey(task.dueDate) === row.dueDate);
      return duplicate
        ? { ...row, matchStatus: 'BLOCKED' as const, message: `系统已有相同计划 ${duplicate.code}，已阻止重复导入`, matchedItemId: null }
        : row;
    })].sort((left, right) => left.rowNumber - right.rowNumber);
    const summary = {
      total: finalRows.length,
      reuse: finalRows.filter(row => row.matchStatus === 'REUSE').length,
      create: finalRows.filter(row => row.matchStatus === 'CREATE').length,
      confirm: finalRows.filter(row => row.matchStatus === 'CONFIRM').length,
      blocked: finalRows.filter(row => row.matchStatus === 'BLOCKED').length,
    };
    return NextResponse.json({ ok: true, fileName: file.name, rows: finalRows, summary });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('sample plan import preview failed', error);
    return NextResponse.json({ ok: false, error: '批量导入预览失败，请检查模板后重试' }, { status: 500 });
  }
}
