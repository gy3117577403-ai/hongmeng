import { Prisma, type QfPackage } from "@prisma/client";
import { pcInt, pcRecord, pcText, type PcInput } from "@/lib/purchasing-domain";
import type { PcActor } from "@/lib/purchasing-service";
import { confirmBomRows, scanBom, FixtureError, type BomMapping, type BomSheet, type BomRow } from "@/lib/quality-fixture-domain";

type Tx = Prisma.TransactionClient;
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

/** The fallback also supports products created by old clients during a rolling upgrade. */
export async function getFixturePreparation(tx: Tx, libraryItemId: string, fallback?: QfPackage | null) {
  const current = await tx.qfPreparation.findUnique({ where: { libraryItemId } });
  if (current) return current;
  const p = fallback || await tx.qfPackage.findFirst({ where: { libraryItemId }, orderBy: { sequence: "desc" } });
  return { libraryItemId, bomFileId: p?.bomFileId || null, bomRows: p?.bomRows || [], bomMapping: p?.bomMapping || null,
    bomConfirmed: p?.bomConfirmed || false, parallelCount: p?.parallelCount || 1, spareCount: p?.spareCount || 0,
    version: 0, updatedById: p?.createdById || "", createdAt: p?.createdAt || null, updatedAt: p?.updatedAt || null };
}

/** Caller holds the shared purchasing transaction lock. No document signature is changed. */
export async function saveFixturePreparation(tx: Tx, input: PcInput, actor: PcActor, legacy = false) {
  const libraryItemId = pcText(input.libraryItemId, "产品", 100);
  const product = await tx.drawingLibraryItem.findFirst({ where: { id: libraryItemId, deletedAt: null } });
  if (!product || product.fixtureRequired !== true) throw new FixtureError("请先选择需要治具，再准备 BOM");
  const before = await getFixturePreparation(tx, libraryItemId);
  if (!legacy || input.preparationVersion !== undefined) {
    const expected = pcInt(input.preparationVersion, "治具准备版本", 0);
    if (before.version !== expected) throw new FixtureError("治具准备已被其他人更新，请刷新后再保存", "FIXTURE_CONFLICT", 409);
  }
  const bomFileId = input.bomFileId ? pcText(input.bomFileId, "BOM", 100) : null;
  const bom = bomFileId ? await tx.qfBomFile.findFirst({ where: { id: bomFileId, libraryItemId, deletedAt: null } }) : null;
  if (bomFileId && !bom) throw new FixtureError("BOM 不存在或不属于该产品");
  const mapping = bom && input.bomMapping ? pcRecord(input.bomMapping) as unknown as BomMapping : null;
  const bomConfirmed = !!bom && !!mapping && input.bomConfirmed === true;
  if (input.bomConfirmed === true && !bomConfirmed) throw new FixtureError("请上传 BOM 并选择表头后确认");
  let base: BomRow[] = [];
  if (bom && mapping) { try { base = scanBom(bom.sheets as unknown as BomSheet[], mapping); } catch (e) { if (bomConfirmed) throw e; } }
  const proposed = Array.isArray(input.bomRows) ? input.bomRows as Partial<BomRow>[] : [];
  const rows = bomConfirmed ? confirmBomRows(base, proposed) : base.map(row => {
    const edit = proposed.find(r => r.sourceRow === row.sourceRow && r.sheet === row.sheet);
    if (!edit) return row;
    // Retain unfinished edits without making them eligible for demand calculation.
    const text = (v: unknown, fallback: string, max: number) => typeof v === "string" ? v.slice(0, max) : fallback;
    return { ...row, model: text(edit.model, row.model, 200), unit: text(edit.unit, row.unit, 20),
      position: text(edit.position, row.position, 400), reason: text(edit.reason, row.reason, 500),
      include: typeof edit.include === "boolean" ? edit.include : null,
      quantity: typeof edit.quantity === "number" && Number.isSafeInteger(edit.quantity) && edit.quantity > 0 ? edit.quantity : null };
  });
  const values = { bomFileId, bomMapping: mapping ? json(mapping) : Prisma.JsonNull, bomRows: json(rows), bomConfirmed,
    parallelCount: pcInt(input.parallelCount ?? before.parallelCount, "同时测试产品数量", 1, 1000),
    spareCount: pcInt(input.spareCount ?? before.spareCount, "每种对插件备用数量", 0, 10000), updatedById: actor.id };
  const after = await tx.qfPreparation.upsert({ where: { libraryItemId }, create: { libraryItemId, ...values },
    update: { ...values, version: { increment: 1 } } });
  await tx.qfEvent.create({ data: { entityType: "PREPARATION", entityId: libraryItemId, action: "SAVE_PREPARATION",
    actorId: actor.id, actorName: actor.displayName || actor.username, snapshot: json({ before, after }) } });
  return after;
}
