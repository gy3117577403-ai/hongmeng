import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { logOp } from '@/lib/logs';
import { NativeUnauthorizedError, nativeError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sanitize(value: Prisma.JsonValue | null): Prisma.JsonValue | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.slice(0, 5).map(sanitize) as Prisma.JsonArray;
  if (typeof value === 'object') {
    const out: Prisma.JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      if (/password|secret|token|key|database_url|session/i.test(key)) continue;
      out[key] = sanitize(item as Prisma.JsonValue);
    }
    return out;
  }
  if (typeof value === 'string') return value.length > 120 ? `${value.slice(0, 117)}...` : value;
  return value;
}

function detailSummary(value: Prisma.JsonValue | null) {
  if (!value) return '';
  const text = JSON.stringify(sanitize(value));
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

export async function GET(req: NextRequest) {
  try {
    await requireNativeUser(req);
    const limit = Math.max(1, Math.min(Number(req.nextUrl.searchParams.get('limit') || 100) || 100, 100));
    const logs = await prisma.operationLog.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { username: true, displayName: true } } },
    });
    return nativeOk({
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
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('操作日志加载失败', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireNativeUser(req);
    const body = await req.json().catch(() => ({})) as { action?: string; targetType?: string; targetId?: string; detail?: Prisma.JsonValue };
    const action = String(body.action || '');
    if (!['copy_work_order_link', 'print_work_order_qr', 'copy_connector_parameter'].includes(action)) return nativeError('操作类型不允许', 400);
    await logOp({
      userId: user.id,
      action,
      targetType: typeof body.targetType === 'string' ? body.targetType.slice(0, 80) : null,
      targetId: typeof body.targetId === 'string' ? body.targetId.slice(0, 120) : null,
      detail: sanitize(body.detail || null),
    });
    return nativeOk({ logged: true });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('操作日志写入失败', 500);
  }
}
