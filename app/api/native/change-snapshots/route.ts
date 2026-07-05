import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { NativeUnauthorizedError, nativeError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeLimit(value: string | null) {
  const n = Number(value || 100) || 100;
  return Math.max(1, Math.min(500, n));
}

function summarize(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== 'object') return '';
  const obj = value as Record<string, unknown>;
  const keys = ['code', 'model', 'originalName', 'displayName', 'productName', 'action', 'count'];
  const parts: string[] = [];
  for (const key of keys) {
    const item = obj[key];
    if (item) parts.push(`${key}: ${String(item).slice(0, 60)}`);
  }
  return parts.slice(0, 4).join('；');
}

export async function GET(req: NextRequest) {
  try {
    await requireNativeUser(req);
    const sp = req.nextUrl.searchParams;
    const where: Prisma.DataChangeSnapshotWhereInput = {};
    const entityType = sp.get('entityType')?.trim();
    const entityId = sp.get('entityId')?.trim();
    const action = sp.get('action')?.trim();
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    if (action) where.action = action;
    const snapshots = await prisma.dataChangeSnapshot.findMany({ where, orderBy: { createdAt: 'desc' }, take: safeLimit(sp.get('limit')) });
    return nativeOk({
      snapshots: snapshots.map(item => ({
        id: item.id,
        entityType: item.entityType,
        entityId: item.entityId,
        action: item.action,
        changedBy: item.changedBy,
        createdAt: item.createdAt.toISOString(),
        beforeJson: item.beforeJson,
        afterJson: item.afterJson,
        summary: summarize(item.afterJson) || summarize(item.beforeJson),
      })),
    });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('变更记录加载失败', 500);
  }
}
