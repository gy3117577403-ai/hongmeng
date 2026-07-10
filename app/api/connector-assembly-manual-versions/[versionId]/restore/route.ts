import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { versionId: string } }) {
  try {
    const user = await requireUser();
    const existing = await prisma.connectorAssemblyManualVersion.findFirst({ where: { id: params.versionId, deletedAt: { not: null } }, include: { manual: true } });
    if (!existing || existing.manual.deletedAt) return NextResponse.json({ ok: false, error: '请先恢复所属说明书' }, { status: 400 });
    const latest = await prisma.connectorAssemblyManualVersion.findFirst({ where: { manualId: existing.manualId, deletedAt: null, isLatest: true } });
    const version = await prisma.connectorAssemblyManualVersion.update({ where: { id: existing.id }, data: { deletedAt: null, isLatest: !latest } });
    await logOp({ userId: user.id, action: 'restore_connector_assembly_manual_version', targetType: 'connector_assembly_manual_version', targetId: version.id, detail: { manualId: version.manualId, revision: version.revision } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '恢复说明书版本失败' }, { status: 500 });
  }
}
