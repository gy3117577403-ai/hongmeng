import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { NextRequest } from 'next/server';
import { NativeUnauthorizedError, nativeError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
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
  if (!configured) {
    return {
      ok: false,
      bucketConfigured: !!bucketName,
      publicEndpointConfigured: !!process.env.S3_PUBLIC_ENDPOINT,
      latencyMs: Date.now() - start,
    };
  }

  try {
    await s3().send(new HeadBucketCommand({ Bucket: bucket() }));
    return {
      ok: true,
      bucketConfigured: true,
      publicEndpointConfigured: !!process.env.S3_PUBLIC_ENDPOINT,
      latencyMs: Date.now() - start,
    };
  } catch {
    return {
      ok: false,
      bucketConfigured: true,
      publicEndpointConfigured: !!process.env.S3_PUBLIC_ENDPOINT,
      latencyMs: Date.now() - start,
    };
  }
}

function warningList() {
  const warnings: string[] = [];
  if (!process.env.APP_BASE_URL) warnings.push('APP_BASE_URL missing');
  if (!process.env.S3_PUBLIC_ENDPOINT) warnings.push('S3_PUBLIC_ENDPOINT missing');
  if (process.env.SEED_RESET_ADMIN_PASSWORD !== 'false') warnings.push('SEED_RESET_ADMIN_PASSWORD != false');
  return warnings;
}

async function loadCounts() {
  const recentSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [workOrders, resourceFiles, connectorParameters, operationLogsRecent, failedUploads] = await Promise.all([
    prisma.workOrder.count({ where: { deletedAt: null } }),
    prisma.resourceFile.count({ where: { deletedAt: null, status: 'uploaded' } }),
    prisma.connectorParameter.count({ where: { deletedAt: null } }),
    prisma.operationLog.count({ where: { createdAt: { gte: recentSince } } }),
    prisma.operationLog.count({ where: { createdAt: { gte: recentSince }, action: 'upload_failed' } }),
  ]);
  return { workOrders, resourceFiles, connectorParameters, operationLogsRecent, failedUploads };
}

export async function GET(req: NextRequest) {
  try {
    await requireNativeUser(req);
    const [database, storage, counts] = await Promise.all([checkDatabase(), checkStorage(), loadCounts()]);
    return nativeOk({
      ok: database.ok && storage.ok,
      app: {
        name: '工单资料库',
        version: 'v2.0.0-native-rc.5',
        mode: 'Harmony Native / ArkUI',
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
      counts,
      warnings: warningList(),
      serverTime: new Date().toISOString(),
    });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('系统状态检查失败', 500);
  }
}
