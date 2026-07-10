import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { parseVersionInput, serializeManualVersion } from '@/lib/connector-assembly-manuals';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AssetOrder = { id?: unknown; sortOrder?: unknown };

export async function PATCH(req: NextRequest, { params }: { params: { versionId: string } }) {
  try {
    const user = await requireUser();
    const existing = await prisma.connectorAssemblyManualVersion.findFirst({ where: { id: params.versionId, deletedAt: null, manual: { deletedAt: null } } });
    if (!existing) return NextResponse.json({ ok: false, error: '说明书版本不存在或已删除' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const parsed = parseVersionInput(body, { partial: true, pageCount: existing.pageCount });
    if (parsed.errors.length) return NextResponse.json({ ok: false, error: parsed.errors.join('；') }, { status: 400 });
    const assetOrder = Array.isArray(body.assetOrder) ? body.assetOrder as AssetOrder[] : [];
    const version = await prisma.$transaction(async tx => {
      if (parsed.data.isLatest) await tx.connectorAssemblyManualVersion.updateMany({ where: { manualId: existing.manualId, id: { not: existing.id }, deletedAt: null }, data: { isLatest: false } });
      for (const row of assetOrder.slice(0, 50)) {
        const id = String(row.id ?? '');
        const sortOrder = Number(row.sortOrder);
        if (id && Number.isInteger(sortOrder)) await tx.connectorAssemblyManualAsset.updateMany({ where: { id, versionId: existing.id, deletedAt: null }, data: { sortOrder } });
      }
      return tx.connectorAssemblyManualVersion.update({ where: { id: existing.id }, data: parsed.data, include: { assets: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } } });
    });
    await logOp({ userId: user.id, action: 'update_connector_assembly_manual', targetType: 'connector_assembly_manual_version', targetId: version.id, detail: { manualId: version.manualId, revision: version.revision } });
    return NextResponse.json({ ok: true, version: serializeManualVersion(version) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') return NextResponse.json({ ok: false, error: '同一说明书的版本号不能重复' }, { status: 409 });
    console.error(error);
    return NextResponse.json({ ok: false, error: '编辑说明书版本失败' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { versionId: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as { confirmText?: string };
    if (String(body.confirmText || '').trim() !== 'DELETE_VERSION') return NextResponse.json({ ok: false, error: '请输入 DELETE_VERSION 确认删除' }, { status: 400 });
    const existing = await prisma.connectorAssemblyManualVersion.findFirst({ where: { id: params.versionId, deletedAt: null, manual: { deletedAt: null } } });
    if (!existing) return NextResponse.json({ ok: false, error: '说明书版本不存在或已删除' }, { status: 404 });
    const deletedAt = new Date();
    const replacement = await prisma.$transaction(async tx => {
      await tx.connectorAssemblyManualVersion.update({ where: { id: existing.id }, data: { deletedAt, isLatest: false } });
      if (!existing.isLatest) return null;
      const next = await tx.connectorAssemblyManualVersion.findFirst({ where: { manualId: existing.manualId, id: { not: existing.id }, deletedAt: null }, orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }] });
      if (next) await tx.connectorAssemblyManualVersion.update({ where: { id: next.id }, data: { isLatest: true } });
      return next;
    });
    await logOp({ userId: user.id, action: 'delete_connector_assembly_manual_version', targetType: 'connector_assembly_manual_version', targetId: existing.id, detail: { manualId: existing.manualId, revision: existing.revision, replacementVersionId: replacement?.id || null } });
    return NextResponse.json({ ok: true, replacementVersionId: replacement?.id || null });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '删除说明书版本失败' }, { status: 500 });
  }
}
