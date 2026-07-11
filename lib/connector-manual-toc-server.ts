import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { normalizeManualToc } from '@/lib/connector-manual-toc';
import type { ConnectorManualTocItem } from '@/lib/connector-manual-toc';

export type ManualTocVersionRecord = {
  id: string;
  manualId: string;
  pageCount: number | null;
  tocJson: Prisma.JsonValue | null;
  updatedAt: Date;
};

export async function findManualTocVersion(versionId: string): Promise<ManualTocVersionRecord | null> {
  return prisma.connectorAssemblyManualVersion.findFirst({
    where: { id: versionId, deletedAt: null, manual: { deletedAt: null } },
    select: { id: true, manualId: true, pageCount: true, tocJson: true, updatedAt: true },
  });
}
export function parseStoredManualToc(version: ManualTocVersionRecord): { items: ConnectorManualTocItem[]; error?: string } {
  return normalizeManualToc(version.tocJson, version.pageCount);
}

export function manualTocVersionConflict(version: ManualTocVersionRecord, expectedUpdatedAt: unknown): boolean {
  const expected = String(expectedUpdatedAt ?? '').trim();
  return !!expected && expected !== version.updatedAt.toISOString();
}

export async function saveManualToc(
  version: ManualTocVersionRecord,
  items: ConnectorManualTocItem[],
): Promise<{ items: ConnectorManualTocItem[]; updatedAt: string } | null> {
  const result = await prisma.connectorAssemblyManualVersion.updateMany({
    where: { id: version.id, updatedAt: version.updatedAt, deletedAt: null },
    data: { tocJson: items as unknown as Prisma.InputJsonValue },
  });
  if (result.count !== 1) return null;
  const updated = await prisma.connectorAssemblyManualVersion.findUnique({
    where: { id: version.id },
    select: { tocJson: true, pageCount: true, updatedAt: true },
  });
  if (!updated) return null;
  const parsed = normalizeManualToc(updated.tocJson, updated.pageCount);
  return { items: parsed.items, updatedAt: updated.updatedAt.toISOString() };
}
