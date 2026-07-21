import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const specificationHeaders = new Set(['产品型号', '产品规格', '规格', '型号']);
const customerHeaders = new Set(['客户', '客户名称']);
const productHeaders = new Set(['品名', '产品名称', '产品']);

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function normalized(value: unknown): string {
  return text(value).replace(/[\s　]+/g, '').replace(/[（）]/g, match => match === '（' ? '(' : ')').toLocaleLowerCase('zh-CN');
}

function positiveSeconds(value: unknown): number | null {
  if (value === null || value === undefined || text(value) === '') return null;
  const number = typeof value === 'number' ? value : Number(text(value).replace(/秒$/, ''));
  if (!Number.isFinite(number) || number <= 0 || number > 86_400) return null;
  return Math.round(number * 1000) / 1000;
}

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size <= 0) {
      return NextResponse.json({ ok: false, error: '请选择 Excel 或 CSV 文件' }, { status: 400 });
    }
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      return NextResponse.json({ ok: false, error: '仅支持 .xlsx、.xls 或 .csv 文件' }, { status: 400 });
    }
    if (file.size > 15 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: '导入文件不能超过 15MB' }, { status: 413 });
    }
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const workbook = /\.csv$/i.test(file.name)
      ? XLSX.read(fileBuffer.toString('utf8').replace(/^\uFEFF/, ''), { type: 'string', cellDates: false })
      : XLSX.read(fileBuffer, { type: 'buffer', cellDates: false });
    const sheetName = workbook.SheetNames[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : null;
    if (!sheet) return NextResponse.json({ ok: false, error: '工作簿中没有可读取的工作表' }, { status: 400 });
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
    const headerIndex = matrix.slice(0, 20).findIndex(row => row.some(cell => specificationHeaders.has(text(cell))));
    if (headerIndex < 0) {
      return NextResponse.json({ ok: false, error: '未找到“产品型号”或“规格”表头' }, { status: 400 });
    }
    const header = matrix[headerIndex].map(text);
    const specificationIndex = header.findIndex(value => specificationHeaders.has(value));
    const customerIndex = header.findIndex(value => customerHeaders.has(value));
    const productIndex = header.findIndex(value => productHeaders.has(value));
    const [definitions, items] = await Promise.all([
      prisma.processDefinition.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, code: true, stageGroup: true },
      }),
      prisma.drawingLibraryItem.findMany({
        where: { deletedAt: null },
        select: { id: true, customerName: true, specification: true, productName: true },
      }),
    ]);
    const definitionByHeader = new Map(definitions.map(definition => [normalized(definition.name), definition]));
    const processColumns = header.map((value, index) => ({ index, definition: definitionByHeader.get(normalized(value)) || null })).filter(column => column.definition);
    if (!processColumns.length) {
      return NextResponse.json({ ok: false, error: '表格中没有与工序库匹配的工序列' }, { status: 400 });
    }
    const itemByExact = new Map(items.map(item => [`${normalized(item.customerName)}::${normalized(item.specification)}`, item]));
    const itemsBySpecification = new Map<string, typeof items>();
    for (const item of items) {
      const key = normalized(item.specification);
      itemsBySpecification.set(key, [...(itemsBySpecification.get(key) || []), item]);
    }

    const parsedRows = matrix.slice(headerIndex + 1, headerIndex + 1001).map((row, offset) => {
      const specification = text(row[specificationIndex]);
      const customerName = customerIndex >= 0 ? text(row[customerIndex]) : '';
      const productName = productIndex >= 0 ? text(row[productIndex]) : '';
      if (!specification) return null;
      const exact = customerName ? itemByExact.get(`${normalized(customerName)}::${normalized(specification)}`) || null : null;
      const candidates = itemsBySpecification.get(normalized(specification)) || [];
      const item = exact || (candidates.length === 1 ? candidates[0] : null);
      const entries = processColumns.flatMap(column => {
        const unitSeconds = positiveSeconds(row[column.index]);
        return unitSeconds && column.definition ? [{
          processDefinitionId: column.definition.id,
          processName: column.definition.name,
          unitSeconds,
        }] : [];
      });
      const warnings: string[] = [];
      if (!item) warnings.push(candidates.length > 1 ? '规格对应多个客户，请补充准确客户名称' : '图纸资料库中未找到该产品');
      if (!entries.length) warnings.push('没有可识别的正数工时');
      return {
        rowNo: headerIndex + offset + 2,
        itemId: item?.id || null,
        specification,
        customerName: customerName || item?.customerName || '',
        productName: productName || item?.productName || '',
        entries,
        totalSeconds: Math.round(entries.reduce((sum, entry) => sum + entry.unitSeconds, 0) * 1000) / 1000,
        status: item && entries.length ? 'ready' : 'invalid',
        warnings,
      };
    }).filter((row): row is NonNullable<typeof row> => Boolean(row));
    const itemCounts = new Map<string, number>();
    for (const row of parsedRows) {
      if (row.itemId) itemCounts.set(row.itemId, (itemCounts.get(row.itemId) || 0) + 1);
    }
    const rows = parsedRows.map(row => {
      if (!row.itemId || (itemCounts.get(row.itemId) || 0) <= 1) return row;
      return {
        ...row,
        status: 'invalid' as const,
        warnings: [...row.warnings, '同一产品在文件中重复出现，请只保留一行'],
      };
    });
    return NextResponse.json({
      ok: true,
      fileName: file.name,
      sheetName,
      processColumns: processColumns.map(column => column.definition!.name),
      rows,
      summary: {
        total: rows.length,
        ready: rows.filter(row => row.status === 'ready').length,
        invalid: rows.filter(row => row.status !== 'ready').length,
        matchedProcessColumns: processColumns.length,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('product time import preview failed', error);
    return NextResponse.json({ ok: false, error: '产品工时表解析失败，请检查文件格式' }, { status: 500 });
  }
}
