import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  buildTerminalToolingImportPreview,
  terminalToolingBladeKey,
  terminalToolingTerminalKey,
  type TerminalToolingImportEntity,
} from '@/lib/terminal-tooling';
import { ext } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function entityValue(value: unknown): TerminalToolingImportEntity | null {
  return value === 'terminals' || value === 'blades' ? value : null;
}

async function fileText(file: File): Promise<string> {
  const extension = ext(file.name);
  if (extension === 'csv') return new TextDecoder('utf-8').decode(await file.arrayBuffer());
  if (extension !== 'xlsx' && extension !== 'xls') throw new Error('仅支持 CSV、XLSX、XLS 文件');
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0] || ''];
  if (!sheet) return '';
  return XLSX.utils.sheet_to_csv(sheet);
}

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const form = await req.formData();
    const entity = entityValue(form.get('entity'));
    const file = form.get('file');
    if (!entity) return NextResponse.json({ ok: false, error: '导入类型无效' }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: '请选择导入文件' }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ ok: false, error: '导入文件不能超过 10MB' }, { status: 400 });
    let text: string;
    try {
      text = await fileText(file);
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : '导入文件解析失败' }, { status: 400 });
    }
    const existingKeys = entity === 'terminals'
      ? new Set((await prisma.terminalToolingTerminal.findMany({ select: { specification: true, manufacturer: true } })).map(item => terminalToolingTerminalKey(item.specification, item.manufacturer)))
      : new Set((await prisma.terminalToolingBlade.findMany({ select: { model: true, manufacturer: true } })).map(item => terminalToolingBladeKey(item.model, item.manufacturer)));
    const preview = buildTerminalToolingImportPreview({ entity, text, existingKeys });
    if (!preview.recognizedHeaders) return NextResponse.json({ ok: false, error: '未识别到端子或刀片库表头' }, { status: 400 });
    const summary = {
      total: preview.rows.length,
      ready: preview.rows.filter(row => row.status === 'ready').length,
      duplicate: preview.rows.filter(row => row.status === 'duplicate').length,
      invalid: preview.rows.filter(row => row.status === 'invalid').length,
      skipped: preview.rows.filter(row => row.status === 'skipped').length,
    };
    return NextResponse.json({ ok: true, entity, fileName: file.name, rows: preview.rows, summary });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '导入预览失败' }, { status: 500 });
  }
}
