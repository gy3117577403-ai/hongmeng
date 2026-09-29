import { Prisma } from '@prisma/client';
import { matchImportDrawing } from '@/lib/import-drawing-association';
import { normalizeProductText } from '@/lib/drawing-product-identity';
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
  type SamplePlanImportRow,
} from '@/lib/sample-plan-import';
import { sampleCustomerLevel } from '@/lib/sample-customer-levels';
import { sampleTaskType, sampleWeek, SamplePlanError } from '@/lib/sample-plan-domain';

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
    const defaults = { taskType: sampleTaskType(form.get('taskType') || 'NEW'), planWeekStartDate: sampleWeek(form.get('week') === 'unplanned' ? null : form.get('week')) };
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
      const parsed = parseSamplePlanRow(raw, index + 1, header.columns, defaults);
      if (!parsed.row) parsedRows.push(blockedRow(raw, index + 1, header.columns, parsed.errors.join('；') || '该行没有可导入数据'));
      else candidatesForMatch.push(parsed.row);
    }
    if (!parsedRows.length && !candidatesForMatch.length) return NextResponse.json({ ok: false, error: '模板中没有待导入数据' }, { status: 400 });

    const requestedKeys = candidatesForMatch.map(row => row.libraryKey).filter(Boolean);
    const exactKeys = candidatesForMatch.map(row => drawingLibraryKey(row.customerName, row.specification));
    const specs = [...new Set(candidatesForMatch.map(row => normalizeProductText(row.specification)))];
    const normalized = specs.length ? await prisma.$queryRaw<{id:string}[]>(Prisma.sql`
      SELECT id FROM drawing_library_items WHERE lower(trim(regexp_replace(normalize(specification, NFKC), '[[:space:]]+', ' ', 'g'))) IN (${Prisma.join(specs)})
    `) : [];
    const records = await prisma.drawingLibraryItem.findMany({
      where: { OR: [{ id: { in: [...requestedKeys, ...normalized.map(item => item.id)] } }, { libraryKey: { in: [...requestedKeys, ...exactKeys] } }] },
      select: { id: true, libraryKey: true, customerName: true, customerCode: true, productName: true, specification: true, deletedAt: true,
        files: { where: { deletedAt: null, isCurrent: true, category: { code: { in: ['drawing', 'sop'] } } }, select: { category: { select: { code: true } } } } },
    });
    const drawingItems = records.map(item => ({ ...item, files: undefined, deletedAt: item.deletedAt?.toISOString() || null,
      drawingFileCount: item.files.filter(file => file.category.code === 'drawing').length,
      sopFileCount: item.files.filter(file => file.category.code === 'sop').length }));
    const duplicateFingerprints = new Map<string,number>();
    const matchedRows: SamplePlanImportRow[] = [];

    for (const row of candidatesForMatch) {
      const fingerprint = samplePlanFingerprint(row);
      if (duplicateFingerprints.has(fingerprint)) {
        row.duplicateInFile = duplicateFingerprints.get(fingerprint);
      }
      else duplicateFingerprints.set(fingerprint,row.rowNumber);
      matchedRows.push({ ...row, ...matchImportDrawing(row, drawingItems) });
    }

    const matchedItemIds = matchedRows.map(row => row.matchedItemId).filter((value): value is string => Boolean(value));
    const existingTasks = await prisma.sampleTask.findMany({
      where: { OR:[{drawingLibraryItemId:{in:matchedItemIds}},{code:{in:matchedRows.map(r=>r.planCode||'').filter(Boolean)}}], deletedAt:null },
      select: { id: true, code: true, version:true, status:true, unitPlannedMilliseconds:true, sourceOrderNo:true, sourceOrderLine:true, drawingLibraryItemId: true, customerLevelCode: true, sampleQuantity: true, dueDate: true, taskType: true, planWeekStartDate: true },
    });
    const finalRows = [...parsedRows, ...matchedRows.map(row => {
      if (row.matchStatus === 'BLOCKED') return row;
      const plans = existingTasks.filter(task => row.planCode ? task.code === row.planCode : task.drawingLibraryItemId === row.matchedItemId && task.status !== 'CANCELLED' && (row.sourceOrderNo
        ? task.sourceOrderNo === row.sourceOrderNo && (task.sourceOrderLine || '') === (row.sourceOrderLine || '')
        : !task.sourceOrderNo && (task.customerLevelCode || '').toUpperCase() === row.customerLevelCode
        && task.sampleQuantity === row.sampleQuantity
        && task.taskType === (row.taskType || 'NEW')
        && (task.planWeekStartDate?.toISOString().slice(0, 10) || null) === (row.planWeekStartDate || null)
        && !!task.dueDate && chinaDateKey(task.dueDate) === row.dueDate));
      if (row.planCode && !plans.length) return {...row,matchStatus:'BLOCKED' as const,message:'指定的样品计划编号不存在，请核对编号'};
      return {...row, existingPlans:plans.map(({drawingLibraryItemId,id,code,version,status,sampleQuantity,sourceOrderNo,unitPlannedMilliseconds,planWeekStartDate,dueDate})=>({drawingLibraryItemId,id,code,version,status,sampleQuantity,sourceOrderNo,unitPlannedMinutes:unitPlannedMilliseconds==null?null:unitPlannedMilliseconds/60000,planWeekStartDate:planWeekStartDate?.toISOString().slice(0,10)||null,dueDate:dueDate?chinaDateKey(dueDate):null}))};
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
    if (error instanceof UnauthorizedError) return unauthorized(error);
    if (error instanceof SamplePlanError) return NextResponse.json({ok:false,error:error.message},{status:error.status});
    console.error('sample plan import preview failed', error);
    return NextResponse.json({ ok: false, error: '批量导入预览失败，请检查模板后重试' }, { status: 500 });
  }
}
