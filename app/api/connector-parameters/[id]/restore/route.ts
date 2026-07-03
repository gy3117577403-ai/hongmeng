import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { serializeConnectorParameter } from '@/lib/connector-parameters';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { connectorParameterSnapshot, snapshotChange } from '@/lib/change-snapshots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const existing = await prisma.connectorParameter.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ ok: false, error: '连接器参数不存在' }, { status: 404 });
    const item = await prisma.connectorParameter.update({
      where: { id: params.id },
      data: { deletedAt: null, updatedBy: user.displayName || user.username },
    });
    await logOp({
      userId: user.id,
      action: 'restore_connector_parameter',
      targetType: 'connector_parameter',
      targetId: item.id,
      detail: { model: item.model, rowNo: item.rowNo },
    });
    await snapshotChange({
      entityType: 'connector_parameter',
      entityId: item.id,
      action: 'restore_connector_parameter',
      before: connectorParameterSnapshot(existing),
      after: connectorParameterSnapshot(item),
      changedBy: user.displayName || user.username,
    });
    return NextResponse.json({ ok: true, parameter: serializeConnectorParameter(item) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '恢复连接器参数失败' }, { status: 500 });
  }
}
