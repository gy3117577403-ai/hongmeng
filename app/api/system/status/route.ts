import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { bucket, s3 } from '@/lib/s3';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function checkDatabase() {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

async function checkStorage() {
  const start = Date.now();
  const bucketName = process.env.S3_BUCKET;
  const endpoint = process.env.S3_ENDPOINT;
  const accessKey = process.env.S3_ACCESS_KEY_ID;
  const secretKey = process.env.S3_SECRET_ACCESS_KEY;
  const configured = !!bucketName && !!endpoint && !!accessKey && !!secretKey;
  if (!configured) return { ok: false, bucketConfigured: !!bucketName, publicEndpointConfigured: !!process.env.S3_PUBLIC_ENDPOINT, latencyMs: Date.now() - start };

  try {
    await s3().send(new HeadBucketCommand({ Bucket: bucket() }));
    return { ok: true, bucketConfigured: true, publicEndpointConfigured: !!process.env.S3_PUBLIC_ENDPOINT, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, bucketConfigured: true, publicEndpointConfigured: !!process.env.S3_PUBLIC_ENDPOINT, latencyMs: Date.now() - start };
  }
}

function warningList() {
  const warnings: string[] = [];
  if (!process.env.APP_BASE_URL) warnings.push('APP_BASE_URL 未配置');
  if (!process.env.S3_PUBLIC_ENDPOINT) warnings.push('S3_PUBLIC_ENDPOINT 未配置');
  if (process.env.SEED_RESET_ADMIN_PASSWORD !== 'false') warnings.push('SEED_RESET_ADMIN_PASSWORD 建议保持 false');
  return warnings;
}

async function loadCounts() {
  const recentSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [workOrders, resourceFiles, connectorParameters, operationLogsRecent, dangerousOps, recentBatches, snapshotsRecent] = await Promise.all([
    prisma.workOrder.count({ where: { deletedAt: null } }),
    prisma.resourceFile.count({ where: { deletedAt: null, status: 'uploaded' } }),
    prisma.connectorParameter.count({ where: { deletedAt: null } }),
    prisma.operationLog.count({ where: { createdAt: { gte: recentSince } } }),
    prisma.operationLog.count({
      where: {
        createdAt: { gte: recentSince },
        action: { in: ['delete_work_order', 'delete_resource_file', 'delete_connector_parameter', 'batch_delete_connector_parameters', 'rollback_connector_parameter_import_batch'] },
      },
    }),
    prisma.connectorParameterImportBatch.count({ where: { createdAt: { gte: recentSince } } }),
    prisma.dataChangeSnapshot.count({ where: { createdAt: { gte: recentSince } } }),
  ]);
  return { workOrders, resourceFiles, connectorParameters, operationLogsRecent, dangerousOps, failedUploads: 0, recentBatches, snapshotsRecent };
}

export async function GET() {
  try {
    await requireUser();
    const [database, storage, counts] = await Promise.all([checkDatabase(), checkStorage(), loadCounts()]);
    return NextResponse.json({
      ok: database.ok && storage.ok,
      app: {
        name: '工单资料库',
        version: 'v1.12.0-rc.1',
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
        bucketConfigured: storage.bucketConfigured,
        publicEndpointConfigured: storage.publicEndpointConfigured,
        latencyMs: storage.latencyMs,
      },
      upload: {
        maxUploadSizeMb: Number(process.env.MAX_UPLOAD_SIZE_MB || 50) || 50,
        supportedTypes: ['PDF', 'JPG', 'PNG'],
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
