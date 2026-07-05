import { logOp } from '@/lib/logs';
import { NativeUnauthorizedError, nativeError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';
import { connectorParameterSnapshot, snapshotChange } from '@/lib/change-snapshots';
import { serializeConnectorParameter } from '@/lib/connector-parameters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireNativeUser(req);
    const old = await prisma.connectorParameter.findUnique({ where: { id: params.id } });
    if (!old) return nativeError('连接器参数不存在', 404);
    const item = await prisma.connectorParameter.update({ where: { id: params.id }, data: { deletedAt: null, updatedBy: user.displayName || user.username } });
    await logOp({ userId: user.id, action: 'restore_connector_parameter', targetType: 'connector_parameter', targetId: item.id, detail: { model: item.model, client: 'harmony_native' } });
    await snapshotChange({ entityType: 'connector_parameter', entityId: item.id, action: 'restore_connector_parameter', before: connectorParameterSnapshot(old), after: connectorParameterSnapshot(item), changedBy: user.displayName || user.username });
    return nativeOk({ parameter: serializeConnectorParameter(item) });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('恢复连接器参数失败', 500);
  }
}
