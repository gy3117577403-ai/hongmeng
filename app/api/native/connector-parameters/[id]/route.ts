import { NextRequest } from 'next/server';
import { connectorParameterSnapshot, snapshotChange } from '@/lib/change-snapshots';
import { parseConnectorParameterInput, serializeConnectorParameter } from '@/lib/connector-parameters';
import { logOp } from '@/lib/logs';
import { NativeUnauthorizedError, nativeError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireNativeUser(req);
    const body = await req.json().catch(() => ({}));
    const parsed = parseConnectorParameterInput(body, { partial: true });
    if (parsed.errors.length) return nativeError(parsed.errors.join('；'), 400);
    const existing = await prisma.connectorParameter.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!existing) return nativeError('连接器参数不存在', 404);

    const userName = user.displayName || user.username;
    const item = await prisma.connectorParameter.update({
      where: { id: params.id },
      data: {
        rowNo: parsed.data.rowNo,
        model: parsed.data.model,
        outerPeelMm: parsed.data.outerPeelMm,
        innerPeelMm: parsed.data.innerPeelMm,
        insertionLengthMm: parsed.data.insertionLengthMm,
        remark: parsed.data.remark,
        isHighlighted: parsed.data.isHighlighted,
        updatedBy: userName,
      },
    });
    await logOp({ userId: user.id, action: 'update_connector_parameter', targetType: 'connector_parameter', targetId: item.id, detail: { model: item.model, rowNo: item.rowNo, isHighlighted: item.isHighlighted, client: 'harmony_native' } });
    await snapshotChange({
      entityType: 'connector_parameter',
      entityId: item.id,
      action: 'update_connector_parameter',
      before: connectorParameterSnapshot(existing),
      after: connectorParameterSnapshot(item),
      changedBy: userName,
    });
    return nativeOk({ parameter: serializeConnectorParameter(item) });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('更新连接器参数失败', 500);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireNativeUser(req);
    const body = await req.json().catch(() => ({})) as { confirmText?: unknown };
    if (String(body.confirmText || '').trim() !== 'DELETE') return nativeError('删除确认不匹配', 400);
    const existing = await prisma.connectorParameter.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!existing) return nativeError('连接器参数不存在', 404);

    const userName = user.displayName || user.username;
    const item = await prisma.connectorParameter.update({
      where: { id: params.id },
      data: { deletedAt: new Date(), updatedBy: userName },
    });
    await logOp({ userId: user.id, action: 'delete_connector_parameter', targetType: 'connector_parameter', targetId: item.id, detail: { model: item.model, rowNo: item.rowNo, client: 'harmony_native' } });
    await snapshotChange({
      entityType: 'connector_parameter',
      entityId: item.id,
      action: 'delete_connector_parameter',
      before: connectorParameterSnapshot(existing),
      after: connectorParameterSnapshot(item),
      changedBy: userName,
    });
    return nativeOk({ deleted: true });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('删除连接器参数失败', 500);
  }
}
