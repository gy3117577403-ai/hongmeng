import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { manualTocDuplicate, normalizeManualToc, sortManualToc } from '@/lib/connector-manual-toc';
import { findManualTocVersion, manualTocVersionConflict, parseStoredManualToc, saveManualToc } from '@/lib/connector-manual-toc-server';
import { logOp } from '@/lib/logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { versionId: string; tocId: string } }) {
  try {
    const user = await requireUser();
    const version = await findManualTocVersion(params.versionId);
    if (!version) return NextResponse.json({ ok: false, error: '说明书版本不存在或已删除' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (manualTocVersionConflict(version, body.expectedUpdatedAt)) return NextResponse.json({ ok: false, error: '目录已被其他操作更新，请刷新后重试' }, { status: 409 });
    const parsed = parseStoredManualToc(version);
    if (parsed.error) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    const current = parsed.items.find(item => item.id === params.tocId);
    if (!current) return NextResponse.json({ ok: false, error: '目录条目不存在' }, { status: 404 });
    const title = body.title === undefined ? current.title : String(body.title ?? '').trim().slice(0, 160);
    const pageStart = body.pageStart === undefined ? current.pageStart : Number(body.pageStart);
    const pageEnd = body.pageEnd === undefined ? current.pageEnd : Number(body.pageEnd);
    if (!title) return NextResponse.json({ ok: false, error: '目录标题不能为空' }, { status: 400 });
    if (!Number.isInteger(pageStart) || pageStart < 1 || !Number.isInteger(pageEnd) || pageEnd < pageStart) return NextResponse.json({ ok: false, error: '目录页码不正确' }, { status: 400 });
    if (version.pageCount && pageEnd > version.pageCount) return NextResponse.json({ ok: false, error: `目录页码不能超过文件总页数 ${version.pageCount}` }, { status: 400 });
    if (manualTocDuplicate(parsed.items, title, pageStart, current.id)) return NextResponse.json({ ok: false, error: `目录“${title}”在第 ${pageStart} 页已存在` }, { status: 409 });
    const nextItems = sortManualToc(parsed.items.map(item => item.id === current.id ? { ...item, title, pageStart, pageEnd } : item));
    const validation = normalizeManualToc(nextItems, version.pageCount);
    if (validation.error) return NextResponse.json({ ok: false, error: validation.error }, { status: 400 });
    const saved = await saveManualToc(version, validation.items);
    if (!saved) return NextResponse.json({ ok: false, error: '目录已被其他操作更新，请刷新后重试' }, { status: 409 });
    await logOp({ userId: user.id, action: 'update_connector_manual_toc', targetType: 'connector_assembly_manual_version', targetId: version.id, detail: { manualId: version.manualId, tocId: current.id, pageStart, pageEnd } });
    return NextResponse.json({ ok: true, tocJson: saved.items, updatedAt: saved.updatedAt });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '更新说明书目录失败' }, { status: 500 });
  }
}
export async function DELETE(req: NextRequest, { params }: { params: { versionId: string; tocId: string } }) {
  try {
    const user = await requireUser();
    const version = await findManualTocVersion(params.versionId);
    if (!version) return NextResponse.json({ ok: false, error: '说明书版本不存在或已删除' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (manualTocVersionConflict(version, body.expectedUpdatedAt)) return NextResponse.json({ ok: false, error: '目录已被其他操作更新，请刷新后重试' }, { status: 409 });
    const parsed = parseStoredManualToc(version);
    if (parsed.error) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    const current = parsed.items.find(item => item.id === params.tocId);
    if (!current) return NextResponse.json({ ok: false, error: '目录条目不存在' }, { status: 404 });
    const saved = await saveManualToc(version, sortManualToc(parsed.items.filter(item => item.id !== current.id)));
    if (!saved) return NextResponse.json({ ok: false, error: '目录已被其他操作更新，请刷新后重试' }, { status: 409 });
    await logOp({ userId: user.id, action: 'delete_connector_manual_toc', targetType: 'connector_assembly_manual_version', targetId: version.id, detail: { manualId: version.manualId, tocId: current.id, pageStart: current.pageStart } });
    return NextResponse.json({ ok: true, tocJson: saved.items, updatedAt: saved.updatedAt });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '删除说明书目录失败' }, { status: 500 });
  }
}
