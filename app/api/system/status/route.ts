import { NextResponse } from 'next/server';
import { appInfo } from '@/lib/app-info';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getSystemReadiness } from '@/lib/system-readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function warningList() {
  const warnings: string[] = [];
  if (!process.env.APP_BASE_URL) warnings.push('APP_BASE_URL missing');
  if (!process.env.S3_PUBLIC_ENDPOINT) warnings.push('S3_PUBLIC_ENDPOINT missing');
  if (process.env.SEED_RESET_ADMIN_PASSWORD !== 'false') warnings.push('SEED_RESET_ADMIN_PASSWORD != false');
  return warnings;
}

async function loadCounts() {
  const recentSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [workOrders, resourceFiles, connectorParameters, operationLogs, operationLogsRecent, dangerousOps, failedUploads, recentBatches, snapshotsRecent] = await Promise.all([
    prisma.workOrder.count({ where: { deletedAt: null } }),
    prisma.resourceFile.count({ where: { deletedAt: null, status: 'uploaded' } }),
    prisma.connectorParameter.count({ where: { deletedAt: null } }),
    prisma.operationLog.count(),
    prisma.operationLog.count({ where: { createdAt: { gte: recentSince } } }),
    prisma.operationLog.count({
      where: {
        createdAt: { gte: recentSince },
        action: { in: ['delete_work_order', 'delete_resource_file', 'delete_connector_parameter', 'batch_delete_connector_parameters', 'rollback_connector_parameter_import_batch', 'rollback_import_batch'] },
      },
    }),
    prisma.operationLog.count({ where: { createdAt: { gte: recentSince }, action: 'upload_failed' } }),
    prisma.connectorParameterImportBatch.count({ where: { createdAt: { gte: recentSince } } }),
    prisma.dataChangeSnapshot.count({ where: { createdAt: { gte: recentSince } } }),
  ]);
  return { workOrders, resourceFiles, connectorParameters, operationLogs, operationLogsRecent, dangerousOps, failedUploads, recentBatches, snapshotsRecent };
}

export async function GET() {
  try {
    await requireUser();
    const [readiness, counts] = await Promise.all([getSystemReadiness(), loadCounts()]);
    const { database, storage } = readiness;
    return NextResponse.json({
      ok: readiness.ok,
      app: {
        ...appInfo(),
        mode: 'Web / PWA',
        uptime: Math.floor(process.uptime()),
      },
      data: {
        mode: '账号登录，共享数据',
        permissions: '无角色权限',
      },
      database: {
        ok: database.ok,
        type: 'PostgreSQL',
        latencyMs: database.latencyMs,
      },
      storage: {
        ok: storage.ok,
        type: 'S3 兼容对象存储',
        bucketConfigured: storage.configured,
        publicEndpointConfigured: !!process.env.S3_PUBLIC_ENDPOINT,
        latencyMs: storage.latencyMs,
      },
      upload: {
        maxUploadSizeMb: Number(process.env.MAX_UPLOAD_SIZE_MB || 50) || 50,
        supportedTypes: ['PDF', 'JPG', 'JPEG', 'PNG', 'WEBP'],
      },
      migrations: {
        schemaReachable: database.ok,
      },
      counts,
      warnings: warningList(),
      serverTime: new Date().toISOString(),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    return NextResponse.json({ ok: false, error: '系统状态检查失败' }, { status: 500 });
  }
}
