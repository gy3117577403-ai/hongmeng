import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { insertManualTocByPage, manualTocDuplicate, normalizeManualToc } from '@/lib/connector-manual-toc';
import type { ConnectorManualTocItem } from '@/lib/connector-manual-toc';
import { findManualTocVersion, manualTocVersionConflict, parseStoredManualToc, saveManualToc } from '@/lib/connector-manual-toc-server';
import { logOp } from '@/lib/logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TocCreateInput = {
  title?: unknown;
  page?: unknown;
  pageStart?: unknown;
  pageEnd?: unknown;
};

function parseAddition(input: TocCreateInput, index: number, pageCount: number | null, userName: string): { item?: ConnectorManualTocItem; error?: string } {
  const title = String(input.title ?? '').trim().slice(0, 160);
  const pageStart = Number(input.pageStart ?? input.page);
  const pageEnd = Number(input.pageEnd ?? input.pageStart ?? input.page);
  if (!title) return { error: '目录标题不能为空' };
  if (!Number.isInteger(pageStart) || pageStart < 1 || !Number.isInteger(pageEnd) || pageEnd < pageStart) return { error: '目录页码不正确' };
  if (pageCount && pageEnd > pageCount) return { error: `目录页码不能超过文件总页数 ${pageCount}` };
  return {
    item: {
      id: `toc_${randomUUID().replace(/-/g, '')}`,
      title,
      pageStart,
      pageEnd,
      sortOrder: index,
      createdBy: userName.slice(0, 120),
      createdAt: new Date().toISOString(),
    },
  };
}
export async function POST(req: NextRequest, { params }: { params: { versionId: string } }) {
  try {
    const user = await requireUser();
    const version = await findManualTocVersion(params.versionId);
    if (!version) return NextResponse.json({ ok: false, error: '说明书版本不存在或已删除' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (manualTocVersionConflict(version, body.expectedUpdatedAt)) return NextResponse.json({ ok: false, error: '目录已被其他操作更新，请刷新后重试' }, { status: 409 });
    const existing = parseStoredManualToc(version);
    if (existing.error) return NextResponse.json({ ok: false, error: existing.error }, { status: 400 });
    const rawInputs = Array.isArray(body.items) ? body.items : [body];
    if (!rawInputs.length || rawInputs.length > 50) return NextResponse.json({ ok: false, error: '单次可添加 1 至 50 条目录' }, { status: 400 });
    const additions: ConnectorManualTocItem[] = [];
    const userName = user.displayName || user.username;
    for (let index = 0; index < rawInputs.length; index += 1) {
      const input = rawInputs[index];
      if (!input || typeof input !== 'object') return NextResponse.json({ ok: false, error: `第 ${index + 1} 条目录格式不正确` }, { status: 400 });
      const parsed = parseAddition(input as TocCreateInput, existing.items.length + index, version.pageCount, userName);
      if (parsed.error || !parsed.item) return NextResponse.json({ ok: false, error: parsed.error || '目录格式不正确' }, { status: 400 });
      if (manualTocDuplicate([...existing.items, ...additions], parsed.item.title, parsed.item.pageStart)) {
        return NextResponse.json({ ok: false, error: `目录“${parsed.item.title}”在第 ${parsed.item.pageStart} 页已存在` }, { status: 409 });
      }
      additions.push(parsed.item);
    }
    const nextItems = insertManualTocByPage(existing.items, additions);
    const validation = normalizeManualToc(nextItems, version.pageCount);
    if (validation.error) return NextResponse.json({ ok: false, error: validation.error }, { status: 400 });
    const saved = await saveManualToc(version, validation.items);
    if (!saved) return NextResponse.json({ ok: false, error: '目录已被其他操作更新，请刷新后重试' }, { status: 409 });
    await logOp({ userId: user.id, action: 'add_connector_manual_toc', targetType: 'connector_assembly_manual_version', targetId: version.id, detail: { manualId: version.manualId, count: additions.length, pages: additions.map(item => item.pageStart) } });
    return NextResponse.json({ ok: true, tocJson: saved.items, updatedAt: saved.updatedAt, addedIds: additions.map(item => item.id) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '添加说明书目录失败' }, { status: 500 });
  }
}
