import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { bucket, s3 } from '@/lib/s3';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function checkDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function checkStorage() {
  const bucketName = process.env.S3_BUCKET;
  const endpoint = process.env.S3_ENDPOINT;
  const accessKey = process.env.S3_ACCESS_KEY_ID;
  const secretKey = process.env.S3_SECRET_ACCESS_KEY;
  const configured = !!bucketName && !!endpoint && !!accessKey && !!secretKey;
  if (!configured) return { ok: false, bucketConfigured: !!bucketName, publicEndpointConfigured: !!process.env.S3_PUBLIC_ENDPOINT };

  try {
    await s3().send(new HeadBucketCommand({ Bucket: bucket() }));
    return { ok: true, bucketConfigured: true, publicEndpointConfigured: !!process.env.S3_PUBLIC_ENDPOINT };
  } catch {
    return { ok: false, bucketConfigured: true, publicEndpointConfigured: !!process.env.S3_PUBLIC_ENDPOINT };
  }
}

export async function GET() {
  try {
    await requireUser();
    const [databaseOk, storage] = await Promise.all([checkDatabase(), checkStorage()]);
    return NextResponse.json({
      ok: databaseOk && storage.ok,
      app: {
        name: '工单资料库',
        version: 'v1.7.0-rc.1',
        mode: 'Web / PWA',
      },
      data: {
        mode: '账号登录，共享数据',
        permissions: '无角色权限',
      },
      database: {
        ok: databaseOk,
        type: 'PostgreSQL',
      },
      storage: {
        ok: storage.ok,
        type: 'S3 兼容对象存储',
        bucketConfigured: storage.bucketConfigured,
        publicEndpointConfigured: storage.publicEndpointConfigured,
      },
      upload: {
        maxUploadSizeMb: Number(process.env.MAX_UPLOAD_SIZE_MB || 50) || 50,
        supportedTypes: ['PDF', 'JPG', 'PNG'],
      },
      serverTime: new Date().toISOString(),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    return NextResponse.json({ ok: false, error: '系统状态检查失败' }, { status: 500 });
  }
}
