import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { assetId: string } }) {
  try {
    const user = await requireUser();
    const existing = await prisma.connectorAssemblyManualAsset.findFirst({ where: { id: params.assetId, deletedAt: { not: null } }, include: { version: { include: { manual: true } } } });
    if (!existing || existing.version.deletedAt || existing.version.manual.deletedAt) return NextResponse.json({ ok: false, error: '请先恢复所属说明书和版本' }, { status: 400 });
    await prisma.connectorAssemblyManualAsset.update({ where: { id: existing.id }, data: { deletedAt: null } });
    if (existing.version.fileMode === 'IMAGE_SET') {
      const count = await prisma.connectorAssemblyManualAsset.count({ where: { versionId: existing.versionId, deletedAt: null } });
      await prisma.connectorAssemblyManualVersion.update({ where: { id: existing.versionId }, data: { pageCount: count } });
    }
    await logOp({ userId: user.id, action: 'restore_connector_assembly_manual_asset', targetType: 'connector_assembly_manual_asset', targetId: existing.id, detail: { versionId: existing.versionId } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '恢复说明书文件失败' }, { status: 500 });
  }
}
