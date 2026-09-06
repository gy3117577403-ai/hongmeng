import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export class ProductionSnapshotExpiredError extends Error {
  readonly code = 'PRODUCTION_SNAPSHOT_EXPIRED';
  readonly status = 409;
  constructor() { super('查询结果已过期，请刷新生产看板后继续加载'); }
}

export function productionSnapshotKey(query: string) {
  return createHash('sha256').update(query).digest('hex');
}

/** PostgreSQL storage makes a continuation usable on any application replica.
 * Ordered keys are fixed for ten minutes; page hydration reads only its orders. */
export async function saveProductionSnapshot<T>(queryKey: string, metadata: unknown, rows: T[]) {
  const expired = await prisma.productionExecutionSnapshot.findMany({
    where: { expiresAt: { lt: new Date() } }, select: { id: true }, orderBy: { expiresAt: 'asc' }, take: 10,
  });
  if (expired.length) await prisma.productionExecutionSnapshot.deleteMany({ where: { id: { in: expired.map(item => item.id) } } });
  return prisma.$transaction(async tx => {
    const snapshot = await tx.productionExecutionSnapshot.create({ data: { queryKey,
      metadata: JSON.parse(JSON.stringify(metadata)) as Prisma.InputJsonValue,
      rowCount: rows.length, expiresAt: new Date(Date.now() + 10 * 60_000) } });
    for (let start = 0; start < rows.length; start += 250) {
      await tx.productionExecutionSnapshotRow.createMany({ data: rows.slice(start, start + 250).map((payload, index) => ({
        snapshotId: snapshot.id, ordinal: start + index, payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,
      })) });
    }
    return snapshot.id;
  }, { timeout: 25_000 });
}

export async function readProductionSnapshot<T, M>(input: { token: string; queryKey: string; offset: number; pageSize: number }) {
  const snapshot = await prisma.productionExecutionSnapshot.findFirst({
    where: { id: input.token, queryKey: input.queryKey, expiresAt: { gt: new Date() } },
    select: { metadata: true, rowCount: true, createdAt: true },
  });
  if (!snapshot) throw new ProductionSnapshotExpiredError();
  // The compound primary key resolves this bounded range without scanning or
  // hydrating the preceding pages. An expired token never falls back to offset
  // against a newly sorted query, which would silently omit executions.
  const rows = await prisma.productionExecutionSnapshotRow.findMany({
    where: { snapshotId: input.token, ordinal: { gte: input.offset, lt: input.offset + input.pageSize } },
    orderBy: { ordinal: 'asc' }, take: input.pageSize, select: { payload: true },
  });
  return { metadata: snapshot.metadata as M, total: snapshot.rowCount, rows: rows.map(row => row.payload as T), createdAt: snapshot.createdAt };
}
