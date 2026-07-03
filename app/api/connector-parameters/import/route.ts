import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  ConnectorImportResult,
  parseConnectorParameterInput,
  parseDelimited,
  rowToConnectorInput,
} from '@/lib/connector-parameters';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { ext } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cleanRows(rows: unknown[][]) {
  return rows
    .map(row => row.map(cell => String(cell ?? '').trim()))
    .filter(row => row.some(Boolean));
}

async function rowsFromFile(file: File) {
  const extension = ext(file.name);
  if (extension === 'csv') {
    const text = new TextDecoder('utf-8').decode(await file.arrayBuffer());
    return parseDelimited(text);
  }
  if (extension === 'xlsx' || extension === 'xls') {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false }) as unknown[][];
    return cleanRows(rows);
  }
  throw new Error('仅支持 CSV、XLSX、XLS 文件');
}

async function rowsFromRequest(req: NextRequest) {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => ({})) as { text?: string };
    return parseDelimited(body.text || '');
  }
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return [];
  return rowsFromFile(file);
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    let rows: string[][];
    try {
      rows = await rowsFromRequest(req);
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : '导入文件解析失败' }, { status: 400 });
    }
    if (rows.length < 2) return NextResponse.json({ ok: false, error: '导入内容为空或缺少数据行' }, { status: 400 });

    const headers = rows[0].map(h => h.trim());
    const knownHeaders = headers.filter(h => ['序号', '型号', '外剥皮mm', '外剥皮', '内剥皮mm', '内剥皮', '入长mm', '入长', '备注', '重点', 'rowNo', 'model', 'outerPeelMm', 'innerPeelMm', 'insertionLengthMm', 'remark', 'isHighlighted'].includes(h));
    if (!knownHeaders.length) return NextResponse.json({ ok: false, error: '未识别到连接器参数表头' }, { status: 400 });

    const userName = user.displayName || user.username;
    const results: ConnectorImportResult[] = [];
    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 1; i < rows.length; i += 1) {
      const line = i + 1;
      const input = rowToConnectorInput(headers, rows[i]);
      const parsed = parseConnectorParameterInput(input);
      if (parsed.empty) {
        skipped += 1;
        results.push({ row: line, model: '', status: 'skipped', message: '空行已跳过' });
        continue;
      }
      if (parsed.errors.length) {
        failed += 1;
        results.push({ row: line, model: String(input.model || ''), status: 'failed', message: parsed.errors.join('；') });
        continue;
      }
      const item = await prisma.connectorParameter.create({
        data: {
          ...parsed.data,
          createdBy: userName,
          updatedBy: userName,
        },
      });
      created += 1;
      results.push({ row: line, model: item.model || '', status: 'created', message: '已新增' });
    }

    await logOp({
      userId: user.id,
      action: 'import_connector_parameters',
      targetType: 'connector_parameter',
      detail: { created, skipped, failed, total: results.length },
    });

    return NextResponse.json({
      ok: true,
      summary: { created, skipped, failed, total: results.length },
      results,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '导入连接器参数失败' }, { status: 500 });
  }
}
