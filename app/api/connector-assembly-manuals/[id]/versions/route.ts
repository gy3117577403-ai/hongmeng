import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { parseVersionInput, serializeManualVersion } from '@/lib/connector-assembly-manuals';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const manual = await prisma.connectorAssemblyManual.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!manual) return NextResponse.json({ ok: false, error: '组装说明书不存在或已删除' }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const parsed = parseVersionInput(body);
    if (parsed.errors.length) return NextResponse.json({ ok: false, error: parsed.errors.join('；') }, { status: 400 });
    const isLatest = parsed.data.isLatest !== false;
    const version = await prisma.$transaction(async tx => {
      if (isLatest) await tx.connectorAssemblyManualVersion.updateMany({ where: { manualId: manual.id, deletedAt: null }, data: { isLatest: false } });
      return tx.connectorAssemblyManualVersion.create({
        data: { ...parsed.data, revision: parsed.data.revision || '', fileMode: parsed.data.fileMode || 'PDF', manualId: manual.id, isLatest, createdBy: user.displayName || user.username },
        include: { assets: true },
      });
    });
    await logOp({ userId: user.id, action: 'upload_connector_assembly_manual_version', targetType: 'connector_assembly_manual_version', targetId: version.id, detail: { manualId: manual.id, revision: version.revision, fileMode: version.fileMode, stage: 'metadata' } });
    return NextResponse.json({ ok: true, version: serializeManualVersion(version) }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') return NextResponse.json({ ok: false, error: '同一说明书的版本号不能重复' }, { status: 409 });
    console.error(error);
    return NextResponse.json({ ok: false, error: '新增说明书版本失败' }, { status: 500 });
  }
}
