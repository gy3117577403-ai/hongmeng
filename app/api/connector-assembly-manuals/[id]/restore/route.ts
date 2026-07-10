import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const existing = await prisma.connectorAssemblyManual.findFirst({ where: { id: params.id, deletedAt: { not: null } } });
    if (!existing) return NextResponse.json({ ok: false, error: '已删除说明书不存在' }, { status: 404 });
    const manual = await prisma.connectorAssemblyManual.update({ where: { id: params.id }, data: { deletedAt: null } });
    await logOp({ userId: user.id, action: 'restore_connector_assembly_manual', targetType: 'connector_assembly_manual', targetId: manual.id, detail: { title: manual.title } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '恢复组装说明书失败' }, { status: 500 });
  }
}
