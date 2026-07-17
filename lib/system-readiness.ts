import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { prisma } from '@/lib/prisma';
import { bucket, s3 } from '@/lib/s3';

export type ReadinessCheck = {
  ok: boolean;
  latencyMs: number;
  configured?: boolean;
};

export async function checkDatabaseReadiness(): Promise<ReadinessCheck> {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch {
    return { ok: false, latencyMs: Date.now() - startedAt };
  }
}

export async function checkStorageReadiness(): Promise<ReadinessCheck> {
  const startedAt = Date.now();
  const configured = Boolean(
    process.env.S3_BUCKET
    && process.env.S3_ENDPOINT
    && process.env.S3_ACCESS_KEY_ID
    && process.env.S3_SECRET_ACCESS_KEY,
  );
  if (!configured) return { ok: false, configured: false, latencyMs: Date.now() - startedAt };

  try {
    await s3().send(new HeadBucketCommand({ Bucket: bucket() }));
    return { ok: true, configured: true, latencyMs: Date.now() - startedAt };
  } catch {
    return { ok: false, configured: true, latencyMs: Date.now() - startedAt };
  }
}

export async function getSystemReadiness() {
  const [database, storage] = await Promise.all([
    checkDatabaseReadiness(),
    checkStorageReadiness(),
  ]);
  return {
    ok: database.ok && storage.ok,
    database,
    storage,
  };
}
