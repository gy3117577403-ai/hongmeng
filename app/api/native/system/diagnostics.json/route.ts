import { NextRequest } from 'next/server';
import { detailSummary, sanitizeDetail } from '@/lib/data-tools';
import { logOp } from '@/lib/logs';
import { NativeUnauthorizedError, nativeError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = await requireNativeUser(req);
    const logs = await prisma.operationLog.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { username: true, displayName: true } } },
    });
    let databaseOk = true;
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      databaseOk = false;
    }
    await logOp({ userId: user.id, action: 'export_diagnostics', targetType: 'system', detail: { logCount: logs.length, databaseOk, client: 'harmony_native' } });
    return nativeOk({
      app: { name: '工单资料库', version: 'v2.0.0-native-rc.5' },
      exportedAt: new Date().toISOString(),
      userAgent: req.headers.get('user-agent') || '',
      health: { ok: databaseOk, database: databaseOk ? 'ok' : 'error' },
      recentLogs: logs.map(log => ({
        createdAt: log.createdAt.toISOString(),
        user: log.user?.displayName || log.user?.username || '系统',
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        detail: sanitizeDetail(log.detail),
        detailSummary: detailSummary(log.detail),
      })),
    });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('导出诊断信息失败', 500);
  }
}
