import { NextRequest } from 'next/server';
import {
  buildConnectorPreviewRows,
  connectorDuplicateKey,
  connectorHeaderNames,
  parseDelimited,
  summarizeConnectorPreview,
} from '@/lib/connector-parameters';
import { NativeUnauthorizedError, nativeError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';
import { ext } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ParsedRows = {
  rows: string[][];
  rowHighlights?: boolean[];
};

function normalizeRows(rows: unknown[][], keepEmpty = false) {
  const normalized = rows.map(row => row.map(cell => String(cell ?? '').trim()));
  if (!keepEmpty) return normalized.filter(row => row.some(Boolean));
  let last = normalized.length - 1;
  while (last >= 0 && !normalized[last].some(Boolean)) last -= 1;
  return normalized.slice(0, last + 1);
}

async function rowsFromFile(file: File): Promise<ParsedRows> {
  const extension = ext(file.name);
  if (extension === 'csv') {
    const text = new TextDecoder('utf-8').decode(await file.arrayBuffer());
    return { rows: parseDelimited(text, { keepEmptyRows: true }) };
  }
  if (extension === 'xlsx' || extension === 'xls') {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: 'buffer', cellStyles: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return { rows: [] };
    const sheet = workbook.Sheets[sheetName];
    const rows = normalizeRows(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: true }) as unknown[][], true);
    return { rows };
  }
  throw new Error('仅支持 CSV、XLSX、XLS 文件');
}

async function rowsFromRequest(req: NextRequest): Promise<ParsedRows> {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => ({})) as { text?: string };
    return { rows: parseDelimited(body.text || '', { keepEmptyRows: true }) };
  }
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return { rows: [] };
  return rowsFromFile(file);
}

async function existingDuplicateKeys() {
  const items = await prisma.connectorParameter.findMany({
    where: { deletedAt: null },
    select: { model: true, outerPeelMm: true, innerPeelMm: true, insertionLengthMm: true, remark: true },
  });
  return new Set(items.map(connectorDuplicateKey));
}

export async function POST(req: NextRequest) {
  try {
    await requireNativeUser(req);
    let parsed: ParsedRows;
    try {
      parsed = await rowsFromRequest(req);
    } catch (e) {
      return nativeError(e instanceof Error ? e.message : '导入文件解析失败', 400);
    }
    if (parsed.rows.length < 2) return nativeError('导入内容为空或缺少数据行', 400);
    const headers = parsed.rows[0].map(header => header.trim());
    if (!headers.filter(header => connectorHeaderNames.has(header)).length) return nativeError('未识别到连接器参数表头', 400);
    const rows = buildConnectorPreviewRows({ headers, rows: parsed.rows.slice(1), rowHighlights: parsed.rowHighlights, existingKeys: await existingDuplicateKeys() });
    return nativeOk({ rows, summary: summarizeConnectorPreview(rows) });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('导入预览失败', 500);
  }
}
