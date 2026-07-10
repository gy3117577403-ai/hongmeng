import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { assetId: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as { displayName?: unknown; sortOrder?: unknown };
    const existing = await prisma.connectorAssemblyManualAsset.findFirst({ where: { id: params.assetId, deletedAt: null, version: { deletedAt: null, manual: { deletedAt: null } } } });
    if (!existing) return NextResponse.json({ ok: false, error: '说明书文件不存在或已删除' }, { status: 404 });
    const sortOrder = Number(body.sortOrder);
    const asset = await prisma.connectorAssemblyManualAsset.update({
      where: { id: existing.id },
      data: {
        displayName: body.displayName === undefined ? undefined : (String(body.displayName || '').trim().slice(0, 240) || null),
        sortOrder: body.sortOrder === undefined || !Number.isInteger(sortOrder) ? undefined : sortOrder,
      },
    });
    await logOp({ userId: user.id, action: 'update_connector_assembly_manual', targetType: 'connector_assembly_manual_asset', targetId: asset.id, detail: { versionId: asset.versionId } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '编辑说明书文件失败' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { assetId: string } }) {
  try {
    const user = await requireUser();
    const existing = await prisma.connectorAssemblyManualAsset.findFirst({ where: { id: params.assetId, deletedAt: null, version: { deletedAt: null, manual: { deletedAt: null } } }, include: { version: true } });
    if (!existing) return NextResponse.json({ ok: false, error: '说明书文件不存在或已删除' }, { status: 404 });
    await prisma.connectorAssemblyManualAsset.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
    if (existing.version.fileMode === 'IMAGE_SET') {
      const count = await prisma.connectorAssemblyManualAsset.count({ where: { versionId: existing.versionId, deletedAt: null } });
      await prisma.connectorAssemblyManualVersion.update({ where: { id: existing.versionId }, data: { pageCount: count } });
    }
    await logOp({ userId: user.id, action: 'delete_connector_assembly_manual_asset', targetType: 'connector_assembly_manual_asset', targetId: existing.id, detail: { versionId: existing.versionId, assetType: existing.assetType } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '删除说明书文件失败' }, { status: 500 });
  }
}
