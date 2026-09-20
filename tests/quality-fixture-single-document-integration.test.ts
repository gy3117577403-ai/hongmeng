import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { prisma } from "../lib/prisma";
import { assertFixturePrintReady, mutateQualityFixture, fixtureReadiness } from "../lib/quality-fixture-service";
import { fixtureSubmissionIssues, fixtureDocumentLabel, fixtureDraftReady } from "../lib/quality-fixture-documents";
import { syncProductDocuments } from "../lib/quality-fixture-sync";
import { qualityFixtureBadges, loadQualityFixtures } from "../lib/quality-fixture-queries";
import { createWorkOrderTravelerPrints, loadWorkOrderTravelerPrintReadiness, loadWorkOrderTravelerPrints, confirmWorkOrderTravelerPrints } from "../lib/work-order-qr-service";
import { inferBomMapping, scanBom, confirmBomRows } from "../lib/quality-fixture-domain";
import type { PcInput } from "../lib/purchasing-domain";
import { mutatePurchasing } from "../lib/purchasing-service";

test("single document review, fixture preparation and mixed printing form one workflow", { skip: process.env.RUN_DB_INTEGRATION !== "1" }, async t => {
  const tag = "QFONE-" + randomUUID().slice(0, 8);
  const admin = await prisma.user.create({ data: { username: tag, displayName: "资料验收管理员", passwordHash: "test-only", laborRole: "ADMIN" } });
  const cmd = async (input: PcInput) => await mutateQualityFixture(input, admin, randomUUID()) as any;
  const settings = await prisma.qfSettings.findUnique({ where: { id: "quality-fixtures" } });
  await cmd({ action: "SAVE_SETTINGS", version: settings?.version, supervisorIds: [admin.id], qualityIds: [admin.id] });
  const categories = await Promise.all(["drawing", "sop"].map(code => prisma.resourceCategory.upsert({ where: { code }, update: {}, create: { code, name: code, sortOrder: 0 } })));
  const row = (id: string) => prisma.qfPackage.findUniqueOrThrow({ where: { id } });
  async function create(kinds: string[], need: boolean | null = false) {
    const key = tag + "-" + randomUUID().slice(0, 6);
    const product = await prisma.drawingLibraryItem.create({ data: { libraryKey: key, customerName: tag, specification: key, fixtureRequired: need,
      files: { create: kinds.map(kind => ({ categoryId: categories.find(c => c.code === kind)!.id, originalName: kind + ".pdf", mimeType: "application/pdf", objectKey: key + "/" + kind, size: 10, version: "V3", uploadedById: admin.id })) } }, include: { files: true } });
    const order = await prisma.workOrder.create({ data: { code: key, productName: key, specification: key, drawingLibraryItemId: product.id, weekStartDate: new Date("2026-09-21T00:00:00+08:00"), stage: "frontend", productionTargetQty: 10, uncompletedQty: "10",
      processRoute: { create: { templateName: "导通", templateVersion: 1, version: 1, status: "in_progress", confirmedAt: new Date(), confirmedById: admin.id,
        steps: { create: { processCode: key, processName: "导通", stageGroup: "frontend", position: 1, sequenceGroup: 1, standardSource: "integration_test", timeBasis: "per_unit", unitLabel: "件", standardMillisecondsPerUnit: 1000, inputQty: 10, status: "current" } } } } } });
    const p = await cmd({ action: "SAVE_PACKAGE", libraryItemId: product.id, revision: "V3", needFixture: need, drawingFileIds: product.files.filter(f => f.categoryId === categories[0].id).map(f => f.id), sopFileIds: product.files.filter(f => f.categoryId === categories[1].id).map(f => f.id) });
    return { product, order, p };
  }
  const submit = async (id: string) => cmd({ action: "SUBMIT", id, version: (await row(id)).version });
  const sign = async (id: string, role: string) => cmd({ action: "APPROVE", id, version: (await row(id)).version, reviewRole: role, confirmed: true });
  const print = (ids: string[], extra = {}) => createWorkOrderTravelerPrints({ workOrderIds: ids, userId: admin.id, actor: admin.username, ...extra });
  const onlySop = await create(["sop"]), onlyDrawing = await create(["drawing"]), both = await create(["drawing", "sop"]);
  await t.test("fixture choice saves without documents; all missing conditions are explained together", async () => {
    const empty = await create([], null);
    await assert.rejects(() => submit(empty.p.id), /至少上传一份图纸或 SOP.*选择是否需要治具/);
    await cmd({ action: "SET_REQUIREMENT", productIds: [empty.product.id], needFixture: false });
    assert.equal((await prisma.drawingLibraryItem.findUniqueOrThrow({ where: { id: empty.product.id } })).fixtureRequired, false);
    const latest = await prisma.qfPackage.findFirstOrThrow({ where: { libraryItemId: empty.product.id }, orderBy: { sequence: "desc" } });
    await assert.rejects(() => submit(latest.id), /至少上传一份图纸或 SOP/);
  });
  await t.test("an existing SOP-only draft becomes submittable without reupload; quality may sign first", async () => {
    const before = await row(onlySop.p.id);
    assert.equal(fixtureDocumentLabel(before), "SOP"); assert.equal(fixtureDraftReady(before), true); assert.deepEqual(fixtureSubmissionIssues(before), []);
    assert.deepEqual((await qualityFixtureBadges([onlySop.product.id], "products"))[0].submissionIssues, []);
    await submit(before.id); await sign(before.id, "QUALITY");
    await assert.rejects(() => print([onlySop.order.id]), /双方审核/);
    const pending = await loadWorkOrderTravelerPrintReadiness({ workOrderIds: [onlySop.order.id] }); assert.equal(pending[0].traveler.ready, false);
    await sign(before.id, "SUPERVISOR");
    const approved = await assertFixturePrintReady(prisma, onlySop.order.id); assert.equal(approved?.sopFiles.length, 1); assert.equal(approved?.drawingFiles.length, 0);
    const ready = (await loadWorkOrderTravelerPrintReadiness({ workOrderIds: [onlySop.order.id] }))[0];
    assert.equal(ready.traveler.ready, true); assert.equal(ready.sop.ready, true); assert.equal(ready.drawing.code, "FIXTURE_DRAWING_NOT_PROVIDED");
  });
  await t.test("drawing-only and dual-document versions both support independent signatures", async () => {
    for (const fixture of [onlyDrawing, both]) { await submit(fixture.p.id); await sign(fixture.p.id, "SUPERVISOR"); await sign(fixture.p.id, "QUALITY"); }
    const ready = (await loadWorkOrderTravelerPrintReadiness({ workOrderIds: [onlyDrawing.order.id] }))[0];
    assert.equal(ready.traveler.ready, true); assert.equal(ready.drawing.ready, true); assert.equal(ready.sop.code, "FIXTURE_SOP_NOT_PROVIDED");
  });
  await t.test("mixed batch generates only existing reviewed materials and freezes their identities", async () => {
    const fixtures = [onlySop, onlyDrawing, both];
    const prints = await print(fixtures.map(f => f.order.id), { includeAvailableDocuments: true, copies: 2 });
    assert.equal(prints.length, 3);
    for (const [index, result] of prints.entries()) {
      const records = await prisma.workOrderQrPrintItem.findMany({ where: { printId: result.printId } });
      assert.deepEqual(records.map(i => i.material).sort(), ["TRAVELER", ...(index !== 1 ? ["SOP"] : []), ...(index !== 0 ? ["DRAWING"] : [])].sort());
      assert.ok(records.every(i => i.copies === 2));
      assert.equal(result.snapshot.documentApproval?.packageId, fixtures[index].p.id);
      assert.equal(result.snapshot.drawingFileId === null, index === 0); assert.equal(result.snapshot.sopFileId === null, index === 1);
    }
    assert.equal((await loadWorkOrderTravelerPrints(prints.map(p => p.printId))).length, 3);
    await confirmWorkOrderTravelerPrints({ printIds: prints.map(p => p.printId), userId: admin.id, actor: admin.username });
    assert.equal((await print([onlySop.order.id]))[0].snapshot.drawingFileId, null);
  });
  await t.test("explicitly asking for an absent category gives a business error without invalid print records", async () => {
    const count = await prisma.workOrderQrPrint.count();
    await assert.rejects(() => print([onlySop.order.id], { mode: "CUSTOM", materials: ["DRAWING"] }), /未提供图纸/);
    await assert.rejects(() => print([onlyDrawing.order.id], { mode: "TRAVELER_SOP_DUPLEX" }), /未提供 SOP/);
    assert.equal(await prisma.workOrderQrPrint.count(), count);
  });
  await t.test("single-document auto-sync uses the SOP revision and does not duplicate submitted evidence", async () => {
    const one = await create(["sop"], null);
    await cmd({ action: "SET_REQUIREMENT", productIds: [one.product.id], needFixture: false });
    const synced = await prisma.qfPackage.findFirstOrThrow({ where: { libraryItemId: one.product.id }, orderBy: { sequence: "desc" } });
    assert.equal(synced.status, "REVIEWING"); assert.equal(synced.revision, "V3");
    const again = await prisma.$transaction(tx => syncProductDocuments(tx, one.product.id, admin)); assert.equal(again?.id, synced.id);
  });
  await t.test("required fixture without BOM can be reviewed and printed; later BOM never changes document approval", async () => {
    const one = await create(["sop"], true);
    await submit(one.p.id); await sign(one.p.id, "QUALITY");
    await assert.rejects(() => print([one.order.id]), /双方审核/);
    await sign(one.p.id, "SUPERVISOR");
    // Previously released source signatures also remain valid after the split.
    const original = await row(one.p.id);
    const legacySignature = createHash("sha256").update(JSON.stringify([true, original.drawingFiles, original.sopFiles])).digest("hex");
    await prisma.qfPackage.update({ where: { id: original.id }, data: { sourceSignature: legacySignature } });
    const approved = await row(one.p.id);
    const before = await print([one.order.id], { includeAvailableDocuments: true });
    assert.match(before[0].snapshot.documentApproval!.fixtureLabel, /BOM 待上传.*尚未计算/);
    const queue = await loadQualityFixtures(new URLSearchParams({ view: "plans", product: one.product.id, q: one.product.specification }), admin);
    assert.equal(queue.preparationRows[0].state, "BOM"); assert.equal(queue.readiness.calculated, false);
    assert.equal((await qualityFixtureBadges([one.product.id], "products"))[0].printAllowed, true);
    const sheets = [{ name: "BOM", rows: [["名称", "型号", "数量"], ["连接器", tag + "-C", "2"]].map(r => r.map(text => ({ text }))) }];
    const mapping = inferBomMapping(sheets), rows = confirmBomRows(scanBom(sheets, mapping), scanBom(sheets, mapping));
    const bom = await prisma.qfBomFile.create({ data: { libraryItemId: one.product.id, name: "bom.xlsx", objectKey: tag + "/bom", sha256: "test", byteSize: 100, sheets, uploadedById: admin.id } });
    const input = { action: "SAVE_PREPARATION", libraryItemId: one.product.id, preparationVersion: 0, bomFileId: bom.id, bomMapping: mapping, bomRows: rows, bomConfirmed: false };
    let prep = await cmd({ ...input, bomRows: rows.map(r => ({ ...r, model: r.model + "-draft", reason: "待核对更名", include: null })) });
    assert.equal((prep.bomRows as any[])[0].model, tag + "-C-draft", "unfinished edits survive saving");
    assert.equal((prep.bomRows as any[])[0].include, null);
    assert.equal((await fixtureReadiness(prisma, approved)).calculated, false);
    assert.match((await assertFixturePrintReady(prisma, one.order.id))!.fixtureLabel, /BOM 待确认/);
    await assert.rejects(() => cmd({ ...input, bomConfirmed: true }), /其他人更新/);
    prep = await cmd({ ...input, preparationVersion: prep.version, bomConfirmed: true });
    const matched = await cmd({ action: "SAVE_MAPPING", connectorModel: tag + "-C", model: tag + "-MATE", initialQuantity: 0 });
    const printed = await print([one.order.id], { includeAvailableDocuments: true }); assert.match(printed[0].snapshot.documentApproval!.fixtureLabel, /缺 2/);
    const ps = await prisma.pcSettings.findUnique({ where: { id: "purchasing" } });
    await mutatePurchasing({ action: "SAVE_SETTINGS", version: ps?.version, reason: "独立验收", purchaseApproverIds: [admin.id], buyerIds: [admin.id], fundApproverIds: [admin.id], financeIds: [admin.id] }, admin, randomUUID());
    const purchase = { action: "CREATE_FIXTURE_PURCHASE", packageId: one.p.id, libraryItemId: one.product.id, preparationVersion: prep.version, fixtureId: matched.fixtureId, quantity: 2, estimateCents: 2000, needDate: "2026-09-28", urgency: "NORMAL" };
    await mutatePurchasing(purchase, admin, randomUUID());
    await assert.rejects(() => mutatePurchasing(purchase, admin, randomUUID()), /最多新增 0/);
    assert.equal((await fixtureReadiness(prisma, approved)).groups[0].incoming, 2);
    assert.equal(await prisma.pcLine.count({ where: { fixturePackageId: one.p.id, request: { source: "FIXTURE" } } }), 1);
    assert.deepEqual(await row(one.p.id), approved, "BOM and purchasing cannot rewrite any signed package field");
    for (const need of [false, true]) {
      await cmd({ action: "SET_REQUIREMENT", productIds: [one.product.id], needFixture: need });
      assert.deepEqual(await row(one.p.id), approved);
      assert.ok(await assertFixturePrintReady(prisma, one.order.id));
    }
    assert.equal(await prisma.qfPackage.count({ where: { libraryItemId: one.product.id } }), 1);
    // Updating BOM before or after matching only recalculates preparation.
    prep = await cmd({ ...input, preparationVersion: prep.version, bomConfirmed: true, parallelCount: 2 });
    assert.equal((await fixtureReadiness(prisma, approved)).groups[0].required, 4);
    assert.equal((await fixtureReadiness(prisma, approved)).groups[0].incoming, 2);
    await assert.rejects(() => mutatePurchasing({ ...purchase, quantity: 1 }, admin, randomUUID()), /BOM 需求已更新/);
    const priorPrints = await loadWorkOrderTravelerPrints(before.map(p => p.printId));
    assert.match(priorPrints[0].snapshot.documentApproval!.fixtureLabel, /待上传/);
    await confirmWorkOrderTravelerPrints({ printIds: before.map(p => p.printId), userId: admin.id, actor: admin.username });
    assert.deepEqual(await row(one.p.id), approved);
    assert.equal(await prisma.qfEvent.count({ where: { entityType: "PREPARATION", entityId: one.product.id, action: "SAVE_PREPARATION" } }), 3);
  });
  await t.test("unconfirmed BOM never blocks first or second review, and invalid BOM can be saved for later mapping", async () => {
    const one = await create(["drawing"], true);
    const bom = await prisma.qfBomFile.create({ data: { libraryItemId: one.product.id, name: "待整理.xlsx", objectKey: one.product.id + "/incomplete", sha256: "test", byteSize: 10, sheets: [], uploadedById: admin.id } });
    await cmd({ action: "SAVE_PREPARATION", libraryItemId: one.product.id, preparationVersion: 0, bomFileId: bom.id, bomConfirmed: false });
    await submit(one.p.id); await sign(one.p.id, "SUPERVISOR"); await sign(one.p.id, "QUALITY");
    assert.ok(await assertFixturePrintReady(prisma, one.order.id));
    assert.match((await fixtureReadiness(prisma, one.p)).label, /BOM 待确认/);
    await assert.rejects(() => cmd({ action: "SAVE_PREPARATION", libraryItemId: one.product.id, preparationVersion: 1, bomFileId: bom.id, bomConfirmed: true }), /选择表头/);
    await prisma.qfBomFile.update({ where: { id: bom.id }, data: { deletedAt: new Date() } });
    assert.ok(await assertFixturePrintReady(prisma, one.order.id), "even a missing BOM original cannot revoke drawing approval");
  });
  await t.test("supplementing the missing category creates a new version without inheriting signatures", async () => {
    const one = await create(["sop"]); await submit(one.p.id); await sign(one.p.id, "SUPERVISOR"); await sign(one.p.id, "QUALITY");
    await prisma.drawingLibraryFile.create({ data: { libraryItemId: one.product.id, categoryId: categories[0].id, originalName: "新增图纸.pdf", mimeType: "application/pdf", size: 10, objectKey: one.product.id + "/new", uploadedById: admin.id } });
    await assert.rejects(() => print([one.order.id]), /更新|审核/);
    const next = await prisma.$transaction(tx => syncProductDocuments(tx, one.product.id, admin));
    assert.notEqual(next?.id, one.p.id); assert.equal(next?.supervisorAt, null); assert.equal(next?.qualityAt, null);
    assert.equal((await row(one.p.id)).status, "APPROVED");
  });
  await t.test("deleted sole evidence cannot be reviewed or printed", async () => {
    const one = await create(["sop"]); await submit(one.p.id);
    await prisma.drawingLibraryFile.update({ where: { id: one.product.files[0].id }, data: { deletedAt: new Date() } });
    await assert.rejects(() => sign(one.p.id, "QUALITY"), /移除|变化/);
    await assert.rejects(() => print([one.order.id], { includeAvailableDocuments: true }), /审核/);
  });
});
test.after(async () => prisma.$disconnect());
