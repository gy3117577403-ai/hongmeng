import { NextRequest } from 'next/server';
import { appInfo } from '@/lib/app-info';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { detailSummary, jsonDownloadResponse, sanitizeDetail } from '@/lib/data-tools';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
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
    await logOp({ userId: user.id, action: 'export_diagnostics', targetType: 'system', detail: { logCount: logs.length, databaseOk } });
    return jsonDownloadResponse('系统诊断信息.json', {
      app: appInfo(),
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
    if (e instanceof UnauthorizedError) return unauthorized();
    return Response.json({ ok: false, error: '导出诊断信息失败' }, { status: 500 });
  }
}
