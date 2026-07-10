import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { versionId: string } }) {
  try {
    const user = await requireUser();
    const existing = await prisma.connectorAssemblyManualVersion.findFirst({ where: { id: params.versionId, deletedAt: null, manual: { deletedAt: null } } });
    if (!existing) return NextResponse.json({ ok: false, error: '说明书版本不存在或已删除' }, { status: 404 });
    await prisma.$transaction([
      prisma.connectorAssemblyManualVersion.updateMany({ where: { manualId: existing.manualId, deletedAt: null }, data: { isLatest: false } }),
      prisma.connectorAssemblyManualVersion.update({ where: { id: existing.id }, data: { isLatest: true } }),
    ]);
    await logOp({ userId: user.id, action: 'mark_connector_assembly_manual_latest', targetType: 'connector_assembly_manual_version', targetId: existing.id, detail: { manualId: existing.manualId, revision: existing.revision } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '设置最新版本失败' }, { status: 500 });
  }
}
