import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 5).map(sanitize);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/password|secret|token|key|database_url|session/i.test(key)) continue;
      out[key] = sanitize(item);
    }
    return out;
  }
  if (typeof value === 'string') return value.length > 120 ? `${value.slice(0, 117)}...` : value;
  return value;
}

function detailSummary(value: unknown) {
  if (!value) return '';
  const text = JSON.stringify(sanitize(value));
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const limit = Math.max(1, Math.min(Number(req.nextUrl.searchParams.get('limit') || 100) || 100, 100));
    const logs = await prisma.operationLog.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { username: true, displayName: true } } },
    });

    return NextResponse.json({
      logs: logs.map(log => ({
        id: log.id,
        createdAt: log.createdAt.toISOString(),
        user: log.user?.displayName || log.user?.username || '系统',
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        detailSummary: detailSummary(log.detail),
      })),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ message: '操作日志加载失败' }, { status: 500 });
  }
}
