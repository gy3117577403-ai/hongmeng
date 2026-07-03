import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const existing = await prisma.connectorParameterFile.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!existing) return NextResponse.json({ ok: false, error: '原始资料文件不存在' }, { status: 404 });
    const file = await prisma.connectorParameterFile.update({
      where: { id: params.id },
      data: { deletedAt: new Date() },
    });
    await logOp({
      userId: user.id,
      action: 'delete_connector_parameter_file',
      targetType: 'connector_parameter_file',
      targetId: file.id,
      detail: { fileName: file.originalName, fileType: file.fileType },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '删除原始资料失败' }, { status: 500 });
  }
}
