import { PrismaClient } from '@prisma/client';

const globalPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaSlowQueryMiddlewareInstalled?: boolean;
};

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function optimizedDatabaseUrl(value = process.env.DATABASE_URL): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) return value;
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', String(positiveInteger(process.env.DB_CONNECTION_LIMIT, 10)));
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', String(positiveInteger(process.env.DB_POOL_TIMEOUT_SECONDS, 10)));
    }
    if (!url.searchParams.has('connect_timeout')) {
      url.searchParams.set('connect_timeout', String(positiveInteger(process.env.DB_CONNECT_TIMEOUT_SECONDS, 10)));
    }
    return url.toString();
  } catch {
    return value;
  }
}

const datasourceUrl = optimizedDatabaseUrl();
export const prisma = globalPrisma.prisma ?? new PrismaClient({
  ...(datasourceUrl ? { datasources: { db: { url: datasourceUrl } } } : {}),
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

if (!globalPrisma.prismaSlowQueryMiddlewareInstalled) {
  const thresholdMs = positiveInteger(process.env.DB_SLOW_QUERY_MS, 750);
  prisma.$use(async (params, next) => {
    const startedAt = performance.now();
    try {
      return await next(params);
    } finally {
      const durationMs = performance.now() - startedAt;
      if (durationMs >= thresholdMs) {
        console.warn('[database] slow prisma operation', {
          model: params.model || 'raw',
          action: params.action,
          durationMs: Number(durationMs.toFixed(1)),
          thresholdMs,
        });
      }
    }
  });
  globalPrisma.prismaSlowQueryMiddlewareInstalled = true;
}

if (process.env.NODE_ENV !== 'production') globalPrisma.prisma = prisma;
