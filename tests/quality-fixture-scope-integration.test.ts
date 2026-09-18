import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { assertFixturePrintReady, mutateQualityFixture } from "../lib/quality-fixture-service";
import { processFixtureSyncQueue } from "../lib/quality-fixture-sync";
import { loadQualityFixtures, qualityFixtureBadges } from "../lib/quality-fixture-queries";
import type { PcInput } from "../lib/purchasing-domain";

test("plan cohort, existing drawings and SOP, fixture-only queue and simple inventory preserve the real workflow", { skip: process.env.RUN_DB_INTEGRATION !== "1" }, async t => {
  const marker = "QFR-" + randomUUID().slice(0, 8);
  const users = await Promise.all(["plan", "supervisor", "quality"].map(name => prisma.user.create({ data: { username: marker + name, displayName: name, passwordHash: "test-only", laborRole: "ADMIN" } })));
  const [planner, supervisor, quality] = users;
  const command = async (input: PcInput, actor = planner) => await mutateQualityFixture(input, actor, randomUUID()) as any;
  const setting = await prisma.qfSettings.findUnique({ where: { id: "quality-fixtures" } });
  await command({ action: "SAVE_SETTINGS", version: setting?.version, supervisorIds: [supervisor.id], qualityIds: [quality.id] });
  const categories = await Promise.all(["drawing", "sop"].map(code => prisma.resourceCategory.upsert({ where: { code }, create: { code, name: code, sortOrder: 0 }, update: {} })));
  const product = await prisma.drawingLibraryItem.create({ data: { libraryKey: marker, customerName: marker, specification: marker, files: { create: categories.map(c => ({ categoryId: c.id, originalName: c.code + ".pdf", mimeType: "application/pdf", objectKey: marker + "/" + c.code, size: 10, uploadedById: planner.id })) } }, include: { files: true } });
  const unrelated = await prisma.drawingLibraryItem.create({ data: { libraryKey: marker + "-unused", customerName: marker, specification: marker + "-unused", fixtureRequired: true } });
  const old = await prisma.workOrder.create({ data: { code: marker + "-old", productName: marker, stage: "frontend", drawingLibraryItemId: product.id, weekStartDate: new Date("2026-09-14T00:00:00+08:00") } });
  const fresh = await prisma.workOrder.create({ data: { code: marker + "-new", productName: marker, stage: "frontend", drawingLibraryItemId: product.id, weekStartDate: new Date("2026-09-21T00:00:00+08:00") } });
  const latest = () => prisma.qfPackage.findFirstOrThrow({ where: { libraryItemId: product.id }, orderBy: { sequence: "desc" } });
  await t.test("fixed week cohort is independent from file upload time and survives carryover", async () => {
    assert.equal(old.documentReviewRequired, false); assert.equal(fresh.documentReviewRequired, true);
    assert.equal(await assertFixturePrintReady(prisma, old.id), null);
    await prisma.workOrder.update({ where: { id: old.id }, data: { weekStartDate: new Date("2026-09-28") } });
    assert.equal(await assertFixturePrintReady(prisma, old.id), null);
    await assert.rejects(() => assertFixturePrintReady(prisma, fresh.id), /初审|复审|审核/);
  });
  await t.test("already uploaded documents enter the same review task once; unknown fixture need remains visible", async () => {
    await processFixtureSyncQueue(200);
    const p = await latest(); assert.equal(p.status, "DRAFT"); assert.equal(p.needFixture, null);
    assert.equal((p.drawingFiles as any[]).length, 1); assert.equal((p.sopFiles as any[]).length, 1);
    await prisma.qfSyncQueue.upsert({ where: { libraryItemId: product.id }, create: { libraryItemId: product.id }, update: { updatedAt: new Date() } });
    await processFixtureSyncQueue(200); assert.equal((await latest()).id, p.id);
    const review = await loadQualityFixtures(new URLSearchParams({ view: "review", q: marker }), planner);
    assert.equal(review.total, 1); assert.equal(review.product?.id, product.id);
    assert.ok(!review.products.some(p => p.id === unrelated.id));
  });
  await t.test("no fixture hides BOM/preparation but still requires two independent drawing and SOP approvals", async () => {
    await command({ action: "SET_REQUIREMENT", productIds: [product.id], needFixture: false });
    let p = await latest(); assert.equal(p.status, "SUPERVISOR"); assert.equal(p.bomFileId, null);
    assert.equal((await loadQualityFixtures(new URLSearchParams({ view: "plans", q: marker }), planner)).total, 0);
    await assert.rejects(() => command({ action: "APPROVE", id: p.id, version: p.version, confirmed: true }, quality), /主管/);
    await command({ action: "APPROVE", id: p.id, version: p.version, confirmed: true }, supervisor);
    await assert.rejects(() => assertFixturePrintReady(prisma, fresh.id), /初审|复审|审核/);
    p = await latest(); await command({ action: "APPROVE", id: p.id, version: p.version, confirmed: true }, quality);
    const approval = await assertFixturePrintReady(prisma, fresh.id); assert.ok(approval); assert.equal(approval.needFixture, false); assert.equal(approval.sopFiles.length, 1);
    const badges = await qualityFixtureBadges([old.id, fresh.id], "orders"); assert.equal(badges[0].status, "LEGACY"); assert.equal(badges[1].printAllowed, true);
  });
  await t.test("a replacement SOP cannot inherit an old approval and empty filtering clears the selected detail", async () => {
    const before = await latest();
    const sop = product.files.find(f => f.categoryId === categories[1].id)!;
    await prisma.drawingLibraryFile.update({ where: { id: sop.id }, data: { isCurrent: false } });
    await prisma.drawingLibraryFile.create({ data: { libraryItemId: product.id, categoryId: categories[1].id, originalName: "sop-v2.pdf", version: "V2", mimeType: "application/pdf", size: 20, objectKey: marker + "/sop-v2", uploadedById: planner.id } });
    await assert.rejects(() => assertFixturePrintReady(prisma, fresh.id), /更新|审核/);
    await processFixtureSyncQueue(200);
    const next = await latest(); assert.notEqual(next.id, before.id); assert.equal(next.status, "SUPERVISOR");
    assert.equal((await prisma.qfPackage.findUniqueOrThrow({ where: { id: before.id } })).status, "APPROVED");
    await assert.rejects(() => assertFixturePrintReady(prisma, fresh.id), /初审|复审|审核/);
    const empty = await loadQualityFixtures(new URLSearchParams({ view: "review", q: "no-match-" + marker, product: product.id }), planner);
    assert.equal(empty.total, 0); assert.equal(empty.product, null);
  });
  await t.test("only opted-in planned products enter fixture preparation; changing choice does not erase history", async () => {
    await command({ action: "SET_REQUIREMENT", productIds: [product.id], needFixture: true });
    const p = await latest(); assert.equal(p.status, "DRAFT"); assert.equal(p.needFixture, true);
    const workbench = await loadQualityFixtures(new URLSearchParams({ view: "plans", q: marker }), planner);
    assert.equal(workbench.total, 1); assert.equal(workbench.product?.id, product.id);
    await command({ action: "SET_REQUIREMENT", productIds: [product.id], needFixture: false });
    assert.equal((await loadQualityFixtures(new URLSearchParams({ view: "plans", q: marker }), planner)).total, 0);
    assert.ok(await prisma.qfPackage.count({ where: { libraryItemId: product.id } }) >= 3);
  });
  await t.test("two-field registration, shared stock, editing, soft deletion and quantity concurrency", async () => {
    const first = await command({ action: "SAVE_MAPPING", connectorModel: marker + "-C1", model: marker + "-M", initialQuantity: 4 });
    const second = await command({ action: "SAVE_MAPPING", connectorModel: marker + "-C2", model: marker + "-M" });
    assert.equal(second.fixtureId, first.fixtureId);
    const f = await prisma.qfFixture.findUniqueOrThrow({ where: { id: first.fixtureId } });
    assert.equal((await prisma.pcStockBalance.aggregate({ where: { itemId: f.itemId }, _sum: { onHand: true } }))._sum.onHand, 4);
    await assert.rejects(() => command({ action: "SAVE_MAPPING", connectorModel: marker + "-C3", model: marker + "-M", initialQuantity: 4 }), /重复初始化/);
    const original = await prisma.qfMapping.findUniqueOrThrow({ where: { id: first.id } });
    const edited = await command({ action: "SAVE_MAPPING", mappingId: original.id, mappingVersion: original.version, connectorModel: marker + "-C1B", fixtureId: f.id });
    assert.equal((await prisma.qfMapping.findUniqueOrThrow({ where: { id: original.id } })).active, false);
    const mapping = await prisma.qfMapping.findUniqueOrThrow({ where: { id: edited.id } });
    await command({ action: "DELETE_MAPPING", id: mapping.id, version: mapping.version });
    assert.equal((await prisma.qfMapping.findUniqueOrThrow({ where: { id: second.id } })).active, true);
    await command({ action: "SET_QUANTITY", fixtureId: f.id, expectedOnHand: 4, quantity: 7 });
    await assert.rejects(() => command({ action: "SET_QUANTITY", fixtureId: f.id, expectedOnHand: 4, quantity: 0 }), /库存已变化/);
    const stocks = await prisma.pcStockBalance.findMany({ where: { itemId: f.itemId } });
    assert.equal(stocks.reduce((n, s) => n + s.onHand, 0), 7);
    assert.equal((await prisma.pcStockMovement.aggregate({ where: { stockId: { in: stocks.map(s => s.id) } }, _sum: { quantity: true } }))._sum.quantity, 7);
  });
});

test.after(async () => prisma.$disconnect());

