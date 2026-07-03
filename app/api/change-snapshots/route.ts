import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
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
  const parts = ['code', 'model', 'originalName', 'displayName', 'productName', 'action', 'count']
    .map(key => obj[key] ? `${key}: ${String(obj[key]).slice(0, 60)}` : '')
    .filter(Boolean);
  return parts.slice(0, 4).join('；');
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const sp = req.nextUrl.searchParams;
    const where: Prisma.DataChangeSnapshotWhereInput = {};
    const entityType = sp.get('entityType')?.trim();
    const entityId = sp.get('entityId')?.trim();
    const action = sp.get('action')?.trim();
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    if (action) where.action = action;

    const snapshots = await prisma.dataChangeSnapshot.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: safeLimit(sp.get('limit')),
    });

    return NextResponse.json({
      ok: true,
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
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '变更记录加载失败' }, { status: 500 });
  }
}
