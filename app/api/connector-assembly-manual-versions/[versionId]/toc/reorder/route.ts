import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { findManualTocVersion, manualTocVersionConflict, parseStoredManualToc, saveManualToc } from '@/lib/connector-manual-toc-server';
import { logOp } from '@/lib/logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { versionId: string } }) {
  try {
    const user = await requireUser();
    const version = await findManualTocVersion(params.versionId);
    if (!version) return NextResponse.json({ ok: false, error: '说明书版本不存在或已删除' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (manualTocVersionConflict(version, body.expectedUpdatedAt)) return NextResponse.json({ ok: false, error: '目录已被其他操作更新，请刷新后重试' }, { status: 409 });
    const parsed = parseStoredManualToc(version);
    if (parsed.error) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    const ids = Array.isArray(body.ids) ? body.ids.map(value => String(value)) : [];
    if (ids.length !== parsed.items.length || new Set(ids).size !== ids.length || parsed.items.some(item => !ids.includes(item.id))) {
      return NextResponse.json({ ok: false, error: '目录排序列表与当前版本不一致，请刷新后重试' }, { status: 409 });
    }
    const byId = new Map(parsed.items.map(item => [item.id, item]));
    const nextItems = ids.map((id, index) => ({ ...byId.get(id)!, sortOrder: index }));
    const saved = await saveManualToc(version, nextItems);
    if (!saved) return NextResponse.json({ ok: false, error: '目录已被其他操作更新，请刷新后重试' }, { status: 409 });
    await logOp({ userId: user.id, action: 'reorder_connector_manual_toc', targetType: 'connector_assembly_manual_version', targetId: version.id, detail: { manualId: version.manualId, count: nextItems.length } });
    return NextResponse.json({ ok: true, tocJson: saved.items, updatedAt: saved.updatedAt });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '调整说明书目录顺序失败' }, { status: 500 });
  }
}
