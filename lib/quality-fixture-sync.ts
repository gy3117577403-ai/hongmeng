import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fixturePlanScope } from "@/lib/quality-fixture-scope";
import { documentFingerprint, lockFixtureBusiness, qfJson, submitPackage, assertPackageFiles } from "@/lib/quality-fixture-service";
import type { PcActor } from "@/lib/purchasing-service";

type Tx = Prisma.TransactionClient;
export async function currentDocumentSource(tx: Tx, libraryItemId: string) {
  const [product, files] = await Promise.all([
    tx.drawingLibraryItem.findUniqueOrThrow({ where: { id: libraryItemId }, select: { fixtureRequired: true } }),
    tx.drawingLibraryFile.findMany({ where: { libraryItemId, deletedAt: null, isCurrent: true, category: { code: { in: ["drawing", "sop"] } } }, include: { category: { select: { code: true } } }, orderBy: { id: "asc" } }),
  ]);
  const evidence = (kind: string) => files.filter(f => f.category.code === kind).map(f => ({ id: f.id, name: f.displayName || f.originalName, version: f.version, sha256: f.sha256 || "", objectKey: f.objectKey, mimeType: f.mimeType }));
  const drawingFiles = evidence("drawing"), sopFiles = evidence("sop");
  const signature = createHash("sha256").update(JSON.stringify([product.fixtureRequired, drawingFiles, sopFiles])).digest("hex");
  return { needFixture: product.fixtureRequired, drawingFiles, sopFiles, signature, files };
}
export async function currentDocumentSignature(tx: Tx, id: string) { return (await currentDocumentSource(tx, id)).signature; }

/** Called under the purchasing lock, on explicit writes/worker jobs only. */
export async function syncProductDocuments(tx: Tx, libraryItemId: string, actor?: PcActor) {
  if (!await tx.drawingLibraryItem.findFirst({ where: { AND: [fixturePlanScope, { id: libraryItemId }] }, select: { id: true } })) return null;
  const source = await currentDocumentSource(tx, libraryItemId);
  const last = await tx.qfPackage.findFirst({ where: { libraryItemId }, orderBy: { sequence: "desc" } });
  if (last?.sourceSignature === source.signature) return last;
  const ownerId = actor?.id || [...source.files].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).find(f => f.uploadedById)?.uploadedById || last?.createdById;
  const owner = ownerId ? await tx.user.findUnique({ where: { id: ownerId }, select: { id: true, username: true, displayName: true } }) : null;
  const a = actor || owner || { id: "system:document-sync", username: "计划资料同步", displayName: "计划资料同步" };
  const hasBom = source.needFixture === true && last?.needFixture === true;
  const values = {
    revision: last?.revision || source.drawingFiles[0]?.version || "A", needFixture: source.needFixture,
    drawingFiles: qfJson(source.drawingFiles), sopFiles: qfJson(source.sopFiles),
    parallelCount: last?.parallelCount || 1, spareCount: last?.spareCount || 0,
    bomFileId: hasBom ? last.bomFileId : null, bomRows: qfJson(hasBom ? last.bomRows : []),
    bomMapping: hasBom && last.bomMapping ? last.bomMapping : Prisma.JsonNull,
    bomConfirmed: !!hasBom && last.bomConfirmed, sourceSignature: source.signature,
  };
  const fingerprint = documentFingerprint({ ...values, bomMapping: hasBom ? last?.bomMapping : null });
  // Never rewrite submitted evidence. File changes produce a new immutable revision.
  const p = last?.status === "DRAFT"
    ? await tx.qfPackage.update({ where: { id: last.id }, data: { ...values, fingerprint, version: { increment: 1 } } })
    : await tx.qfPackage.create({ data: { ...values, fingerprint, libraryItemId, sequence: (last?.sequence || 0) + 1, createdById: a.id } });
  await tx.qfEvent.create({ data: { entityType: "PACKAGE", entityId: p.id, action: "SYNC_PLAN_DOCUMENTS", actorId: a.id,
    actorName: a.displayName || a.username, snapshot: qfJson({ signature: source.signature, drawingCount: source.drawingFiles.length, sopCount: source.sopFiles.length }) } });
  const settings = await tx.qfSettings.findUnique({ where: { id: "quality-fixtures" } });
  let complete = true;
  try { await assertPackageFiles(tx, p, true); } catch { complete = false; }
  if (complete && owner && settings?.supervisorIds.some(id => id !== a.id) && settings.qualityIds.some(id => id !== a.id))
    await submitPackage(tx, { id: p.id, version: p.version }, a);
  return await tx.qfPackage.findUnique({ where: { id: p.id } });
}

export async function processFixtureSyncQueue(limit = 30) {
  const rows = await prisma.qfSyncQueue.findMany({ orderBy: { updatedAt: "asc" }, take: limit });
  let processed = 0;
  for (const row of rows) {
    try {
      const done = await prisma.$transaction(async tx => {
        const locked = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended('hongmeng-purchasing-v1',0)) AS locked`;
        if (!locked[0]?.locked) return false;
        if (!await tx.qfSyncQueue.findUnique({ where: { libraryItemId: row.libraryItemId } })) return false;
        await syncProductDocuments(tx, row.libraryItemId);
        await tx.qfSyncQueue.deleteMany({ where: { libraryItemId: row.libraryItemId, updatedAt: { lte: row.updatedAt } } });
        return true;
      }, { maxWait: 5000, timeout: 15000 });
      if (done) processed++;
    } catch (error) {
      // Isolate a failed product so all other plans continue; retain its queued retry.
      console.error("[quality-fixture-sync] Product sync failed", row.libraryItemId, error instanceof Error ? error.message : "unknown");
    }
  }
  return { processed, pending: processed === limit };
}

export async function setFixtureRequirement(tx: Tx, ids: string[], need: boolean, actor: PcActor) {
  await lockFixtureBusiness(tx);
  const products = await tx.drawingLibraryItem.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, fixtureRequired: true } });
  if (products.length !== ids.length) throw new Error("所选产品不存在或已归档");
  for (const p of products) {
    await tx.drawingLibraryItem.update({ where: { id: p.id }, data: { fixtureRequired: need } });
    if (p.fixtureRequired !== need) await tx.qfEvent.create({ data: { entityType: "PRODUCT", entityId: p.id, action: "SET_FIXTURE_REQUIREMENT",
      actorId: actor.id, actorName: actor.displayName || actor.username, snapshot: { before: p.fixtureRequired, after: need } } });
    await syncProductDocuments(tx, p.id, actor);
  }
  return { count: products.length };
}
