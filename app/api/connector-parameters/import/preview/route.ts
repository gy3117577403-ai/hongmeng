import { NextRequest, NextResponse } from 'next/server';
import {
  buildConnectorPreviewRows,
  connectorDuplicateKey,
  connectorHeaderNames,
  parseDelimited,
  summarizeConnectorPreview,
} from '@/lib/connector-parameters';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
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

function isYellowRgb(value: string) {
  let color = value.trim().replace(/^#/, '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (color.length === 8) color = color.slice(2);
  if (color.length !== 6) return false;
  if (['FFFF00', 'FFF000', 'FFC000', 'FFEB3B'].includes(color)) return true;
  const r = Number.parseInt(color.slice(0, 2), 16);
  const g = Number.parseInt(color.slice(2, 4), 16);
  const b = Number.parseInt(color.slice(4, 6), 16);
  return r >= 220 && g >= 170 && b <= 120;
}

function cellColorValues(cell: unknown) {
  const values: string[] = [];
  const item = cell as {
    s?: {
      fgColor?: { rgb?: string; indexed?: number };
      bgColor?: { rgb?: string; indexed?: number };
      fill?: {
        fgColor?: { rgb?: string; indexed?: number };
        bgColor?: { rgb?: string; indexed?: number };
      };
    };
  } | undefined;
  const candidates = [
    item?.s?.fgColor,
    item?.s?.bgColor,
    item?.s?.fill?.fgColor,
    item?.s?.fill?.bgColor,
  ];
  for (const candidate of candidates) {
    if (candidate?.rgb) values.push(candidate.rgb);
    if (candidate?.indexed === 13) values.push('FFFF00');
  }
  return values;
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
    const rowHighlights = rows.slice(1).map((row, index) => {
      const sheetRowIndex = index + 1;
      for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
        const cell = sheet[XLSX.utils.encode_cell({ r: sheetRowIndex, c: columnIndex })];
        if (cellColorValues(cell).some(isYellowRgb)) return true;
      }
      return false;
    });
    return { rows, rowHighlights };
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
    select: {
      model: true,
      outerPeelMm: true,
      innerPeelMm: true,
      insertionLengthMm: true,
      remark: true,
    },
  });
  return new Set(items.map(connectorDuplicateKey));
}

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    let parsed: ParsedRows;
    try {
      parsed = await rowsFromRequest(req);
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : '导入文件解析失败' }, { status: 400 });
    }
    if (parsed.rows.length < 2) return NextResponse.json({ ok: false, error: '导入内容为空或缺少数据行' }, { status: 400 });

    const headers = parsed.rows[0].map(header => header.trim());
    const knownHeaders = headers.filter(header => connectorHeaderNames.has(header));
    if (!knownHeaders.length) return NextResponse.json({ ok: false, error: '未识别到连接器参数表头' }, { status: 400 });

    const rows = buildConnectorPreviewRows({
      headers,
      rows: parsed.rows.slice(1),
      rowHighlights: parsed.rowHighlights,
      existingKeys: await existingDuplicateKeys(),
    });

    return NextResponse.json({
      ok: true,
      rows,
      summary: summarizeConnectorPreview(rows),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '导入预览失败' }, { status: 500 });
  }
}
