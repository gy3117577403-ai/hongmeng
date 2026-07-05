import { NextRequest } from 'next/server';
import { connectorParameterSnapshot, snapshotChange } from '@/lib/change-snapshots';
import { logOp } from '@/lib/logs';
import { NativeUnauthorizedError, nativeError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await requireNativeUser(req);
    const body = await req.json().catch(() => ({})) as { ids?: unknown; action?: unknown; confirmText?: unknown };
    const ids = Array.isArray(body.ids) ? Array.from(new Set(body.ids.map(id => String(id || '').trim()).filter(Boolean))).slice(0, 200) : [];
    const action = String(body.action || '');
    if (!ids.length) return nativeError('请先选择参数行', 400);
    if (!['highlight', 'unhighlight', 'delete'].includes(action)) return nativeError('批量操作类型不支持', 400);
    if (action === 'delete' && String(body.confirmText || '').trim() !== 'DELETE') return nativeError('删除确认不匹配', 400);
    const userName = user.displayName || user.username;
    const beforeItems = await prisma.connectorParameter.findMany({ where: { id: { in: ids }, deletedAt: null }, take: 50 });
    if (action === 'delete') {
      const result = await prisma.connectorParameter.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { deletedAt: new Date(), updatedBy: userName } });
      await logOp({ userId: user.id, action: 'batch_delete_connector_parameters', targetType: 'connector_parameter', detail: { count: result.count, client: 'harmony_native' } });
      await snapshotChange({ entityType: 'connector_parameter', entityId: 'batch', action: 'batch_delete_connector_parameters', before: { count: beforeItems.length, items: beforeItems.map(connectorParameterSnapshot) }, after: { count: result.count, softDelete: true }, changedBy: userName });
      return nativeOk({ count: result.count });
    }
    const isHighlighted = action === 'highlight';
    const result = await prisma.connectorParameter.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { isHighlighted, updatedBy: userName } });
    await logOp({ userId: user.id, action: 'batch_update_connector_parameters', targetType: 'connector_parameter', detail: { count: result.count, isHighlighted, client: 'harmony_native' } });
    await snapshotChange({ entityType: 'connector_parameter', entityId: 'batch', action: 'batch_update_connector_parameters', before: { count: beforeItems.length, isHighlightedBefore: beforeItems.filter(item => item.isHighlighted).length }, after: { count: result.count, isHighlighted }, changedBy: userName });
    return nativeOk({ count: result.count });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('批量操作失败', 500);
  }
}

export const PATCH = POST;
