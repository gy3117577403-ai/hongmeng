import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { mutateQualityFixture, assertFixturePrintReady, fixtureReadiness, assertFixtureDrawingMutable } from "../lib/quality-fixture-service";
import { mutatePurchasing, type PcActor } from "../lib/purchasing-service";
import { loadPurchasing } from "../lib/purchasing-queries";
import { createWorkOrderTravelerPrints, loadWorkOrderTravelerPrints, confirmWorkOrderTravelerPrints, loadWorkOrderTravelerPrintReadiness } from "../lib/work-order-qr-service";
import { confirmBomRows, inferBomMapping, scanBom, fixtureAvailable } from "../lib/quality-fixture-domain";
import type { PcInput } from "../lib/purchasing-domain";

test("fixture documents, independent review, procurement and physical inventory close the real database loop", { skip: process.env.RUN_DB_INTEGRATION !== "1" }, async t => {
  const marker = "QF-" + randomUUID().slice(0, 8), date = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  const people = await Promise.all(["计划", "主管", "质量", "采购"].map((name, i) => prisma.user.create({ data: {
    username: marker + "-" + i, displayName: marker + name, passwordHash: "not-a-login-hash", laborRole: "ADMIN",
  } })));
  const [planner, supervisor, quality, buyer] = people;
  const qf = async (input: PcInput, actor: PcActor = planner, key = randomUUID()) => await mutateQualityFixture(input, actor, key) as any;
  const pc = async (input: PcInput, actor: PcActor = buyer, key = randomUUID()) => await mutatePurchasing(input, actor, key) as any;
  const s = await prisma.qfSettings.findUnique({ where: { id: "quality-fixtures" } });
  await qf({ action: "SAVE_SETTINGS", version: s?.version, supervisorIds: [supervisor.id], qualityIds: [quality.id] });
  const ps = await prisma.pcSettings.findUnique({ where: { id: "purchasing" } });
  await pc({ action: "SAVE_SETTINGS", version: ps?.version, reason: "独立测试库采购验收", purchaseApproverIds: [buyer.id], buyerIds: [buyer.id], fundApproverIds: [buyer.id], financeIds: [buyer.id] });
  const category = await prisma.resourceCategory.upsert({ where: { code: "drawing" }, create: { code: "drawing", name: "原图", sortOrder: 1 }, update: {} });
  const product = await prisma.drawingLibraryItem.create({ data: { customerName: marker, productName: "导通测试产品", specification: marker + "-SPEC", libraryKey: marker,
    files: { create: { categoryId: category.id, originalName: "受审图纸.pdf", mimeType: "application/pdf", size: 10, objectKey: "integration/" + marker, sha256: "test-hash", uploadedById: planner.id } } },
    include: { files: true } });
  const order = await prisma.workOrder.create({ data: {
    code: marker, customerName: marker, productName: "导通测试", specification: product.specification, drawingLibraryItemId: product.id,
    stage: "frontend", status: "processing", processName: "cut", productionTargetQty: 100, uncompletedQty: "100", completedQty: "0", planType: "managed_plan", planActive: true,
    processRoute: { create: { templateName: "导通工序", templateVersion: 1, status: "in_progress", version: 1, confirmedAt: new Date(), confirmedById: planner.id,
      steps: { create: { processCode: marker, processName: "导通", stageGroup: "frontend", position: 1, sequenceGroup: 1, standardSource: "integration_test", timeBasis: "per_unit", unitLabel: "套", standardMillisecondsPerUnit: 3000, inputQty: 100, status: "current" } } } },
  } });
  const print = () => createWorkOrderTravelerPrints({ workOrderIds: [order.id], userId: planner.id, actor: planner.displayName! });
  const packageRow = (id: string) => prisma.qfPackage.findUniqueOrThrow({ where: { id } });
  const versionInput = async (id: string) => ({ id, version: (await packageRow(id)).version });
  const review = async (id: string, actor: PcActor) => qf({ action: "APPROVE", ...await versionInput(id), confirmed: true }, actor);
  const bomSheets = [{ name: "BOM", rows: [["名称","型号","数量","单位","位号"],["连接器",marker+"-C1","2","个","X1 X2"],["插座",marker+"-C2","1","个","X3"],["导线","WIRE","8","米",""]].map(r => r.map(text => ({ text }))) }];
  const bom = await prisma.qfBomFile.create({ data: { libraryItemId: product.id, name: "连接器.xlsx", objectKey: "integration/" + marker + "/bom", sha256: "bom-test", byteSize: 100, sheets: bomSheets, uploadedById: planner.id } });
  const mapping = inferBomMapping(bomSheets), rows = confirmBomRows(scanBom(bomSheets, mapping), scanBom(bomSheets, mapping));
  let p = await qf({ action: "SAVE_PACKAGE", libraryItemId: product.id, revision: "A", needFixture: true, drawingFileIds: [product.files[0].id],
    bomFileId: bom.id, bomMapping: mapping, bomRows: rows, bomConfirmed: true, parallelCount: 2, spareCount: 1 });
  await t.test("all formal print stages require independent supervisor then quality approval", async () => {
    await assert.rejects(print, /初审|复审/);
    await qf({ action: "SUBMIT", ...await versionInput(p.id) });
    await assert.rejects(() => review(p.id, quality), /主管/);
    await assert.rejects(() => review(p.id, planner), /主管|自审/);
    await review(p.id, supervisor);
    await assert.rejects(print, /初审|复审/);
    await assert.rejects(() => review(p.id, supervisor), /质量|自审/);
    await review(p.id, quality);
    const [printed] = await print();
    assert.equal(printed.snapshot.documentApproval?.fixtureLabel, "2 项待匹配");
    assert.equal(printed.snapshot.documentApproval?.revision, "A");
    await confirmWorkOrderTravelerPrints({ printIds: [printed.printId], userId: planner.id, actor: planner.username });
    assert.equal((await loadWorkOrderTravelerPrintReadiness({ workOrderIds: [order.id] }))[0].traveler.ready, true);
  });
  const m = await qf({ action: "SAVE_MAPPING", connectorModel: marker + "-C1", model: marker + "-MATE", name: "导通对插件", unit: "个", evidence: "厂家配对资料及实物验证" });
  await qf({ action: "SAVE_MAPPING", connectorModel: marker + "-C2", fixtureId: m.fixtureId, evidence: "同针位规格确认" });
  const readiness = await fixtureReadiness(prisma, await packageRow(p.id));
  assert.equal(readiness.groups.length, 1); assert.equal(readiness.groups[0].required, 7, "shared SKU aggregates connector demand, spare once, ignores order quantity");
  assert.equal((await assertFixturePrintReady(prisma, order.id)).fixtureLabel, "治具缺 7");
  let lineId = "";
  await t.test("duplicate and concurrent fixture purchasing cannot over-cover the shortage", async () => {
    const request = { action: "CREATE_FIXTURE_PURCHASE", packageId: p.id, version: (await packageRow(p.id)).version, fixtureId: m.fixtureId, quantity: 7, estimateCents: 7000, needDate: date };
    const key = randomUUID();
    const r = await pc(request, planner, key); lineId = r.lineIds[0];
    assert.deepEqual(await pc(request, planner, key), r);
    await assert.rejects(() => pc(request, planner), /最多新增 0/);
    const results = await Promise.allSettled([pc({ ...request, quantity: 1 }, planner), pc({ ...request, quantity: 1 }, planner)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 0);
    assert.equal((await loadPurchasing({ source: "NORMAL", q: marker }, planner)).total, 0);
    assert.equal((await loadPurchasing({ source: "FIXTURE", q: marker }, planner)).total, 1);
    const requestRow = await prisma.pcLine.findUniqueOrThrow({ where: { id: lineId }, include: { request: true } });
    assert.equal(requestRow.request.source, "FIXTURE");
  });
  const entry = async () => { const l = await prisma.pcLine.findUniqueOrThrow({ where: { id: lineId } }); return { id: l.id, version: l.version }; };
  await pc({ action: "APPROVE_LINES", entries: [await entry()] });
  await pc({ action: "PURCHASE", entries: [{ ...await entry(), actualCents: 7000 }], settlement: "CORPORATE", supplier: marker, payee: "供应商", bank: "验收银行", account: "TEST-FIXTURE", eta: date });
  let stockId = "";
  await t.test("partial receipt, validation, holds and reservations share one ledger and reject replay", async () => {
    const receipt = { action: "RECEIVE", entries: [{ ...await entry(), quantity: 3 }], date, warehouse: "治具库", location: marker, accepted: true, fixtureDisposition: "HELD", acceptanceNote: "型号及数量已核实，待组装" };
    const key = randomUUID(); await pc(receipt, buyer, key); await pc(receipt, buyer, key);
    let b = await prisma.pcStockBalance.findFirstOrThrow({ where: { lineId } }); stockId = b.id;
    assert.equal(b.onHand, 3); assert.equal(b.held, 3); assert.equal(fixtureAvailable(b), 0);
    await assert.rejects(() => qf({ action: "STOCK", kind: "ISSUE", id: b.id, version: b.version, quantity: 1, libraryItemId: product.id, person: "员工甲" }), /可用/);
    await qf({ action: "STOCK", kind: "VERIFY", id: b.id, version: b.version, quantity: 3, reason: "实物对插和导通记录", fitConfirmed: true, continuityConfirmed: true });
    await pc({ ...receipt, entries: [{ ...await entry(), quantity: 4 }], fixtureDisposition: "AVAILABLE", fitConfirmed: true, continuityConfirmed: true, acceptanceNote: "对插适配、导通验证通过" });
    b = await prisma.pcStockBalance.findUniqueOrThrow({ where: { id: b.id } }); assert.equal(b.onHand, 7); assert.equal(fixtureAvailable(b), 7);
    const concurrent = await Promise.allSettled(["甲","乙"].map(person => qf({ action: "STOCK", kind: "RESERVE", id: b.id, version: b.version, quantity: 5, libraryItemId: product.id, person })));
    assert.equal(concurrent.filter(r => r.status === "fulfilled").length, 1);
    b = await prisma.pcStockBalance.findUniqueOrThrow({ where: { id: b.id } });
    const holder = await prisma.qfHolding.findFirstOrThrow({ where: { stockId: b.id, reserved: 5 } });
    await qf({ action: "STOCK", kind: "ISSUE", id: b.id, version: b.version, quantity: 5, libraryItemId: product.id, person: holder.person });
    b = await prisma.pcStockBalance.findUniqueOrThrow({ where: { id: b.id } }); assert.equal(b.onHand, 2); assert.equal(b.issued, 5); assert.equal(b.reserved, 0);
    await qf({ action: "STOCK", kind: "RETURN", id: b.id, version: b.version, quantity: 5, libraryItemId: product.id, person: holder.person, returnCondition: "CHECK" });
    b = await prisma.pcStockBalance.findUniqueOrThrow({ where: { id: b.id } }); assert.equal(b.onHand, 7); assert.equal(b.held, 5); assert.equal(b.issued, 0);
    await assert.rejects(() => pc({ action: "ISSUE", id: b.id, version: b.version, quantity: 1, person: "绕过治具库", reason: "测试" }), /治具库/);
    assert.equal((await prisma.pcStockMovement.aggregate({ where: { stockId: b.id }, _sum: { quantity: true } }))._sum.quantity, b.onHand);
  });
  await t.test("ordinary and fixture funds cannot mix and fixture funds retain source", async () => {
    const n = await pc({ action: "SAVE_REQUEST", submit: true, purpose: marker, lines: [{ name: "普通物品", spec: "NORMAL", quantity: 1, unit: "件", estimateCents: 100, needDate: date }] });
    const normal = async () => { const l = await prisma.pcLine.findUniqueOrThrow({ where: { id: n.lineIds[0] } }); return { id: l.id, version: l.version }; };
    await pc({ action: "APPROVE_LINES", entries: [await normal()] });
    await pc({ action: "PURCHASE", entries: [{ ...await normal(), actualCents: 100 }], settlement: "CORPORATE", supplier: marker, payee: "供应商", bank: "验收银行", account: "TEST-FIXTURE", eta: date });
    await assert.rejects(async () => pc({ action: "CREATE_FUND", entries: [await entry(), await normal()], amountCents: 7100 }), /分别申请资金/);
    const f = await pc({ action: "CREATE_FUND", entries: [await entry()], amountCents: 7000 });
    assert.equal((await prisma.pcFund.findUniqueOrThrow({ where: { id: f.id } })).source, "FIXTURE");
  });
  await t.test("new revisions do not overwrite approval; superseded and revoked print snapshots are enforced", async () => {
    const [oldPrint] = await print();
    const old = await packageRow(p.id);
    const draft = await qf({ action: "SAVE_PACKAGE", id: old.id, version: old.version, libraryItemId: product.id, revision: "B", needFixture: false, drawingFileIds: [product.files[0].id] });
    assert.notEqual(draft.id, old.id); assert.equal(draft.bomFileId, null); assert.equal(draft.reason, "");
    assert.equal((await assertFixturePrintReady(prisma, order.id)).packageId, old.id);
    await qf({ action: "SUBMIT", ...await versionInput(draft.id) }); await review(draft.id, supervisor); await review(draft.id, quality);
    await assert.rejects(() => loadWorkOrderTravelerPrints([oldPrint.printId]), /停用/);
    await qf({ action: "CONTINUE_OLD_VERSION", ...await versionInput(old.id), workOrderIds: [order.id], reason: "已投产旧批次保留适用范围" }, quality);
    assert.equal((await loadWorkOrderTravelerPrints([oldPrint.printId])).length, 1);
    const [latestPrint] = await print(); assert.equal(latestPrint.snapshot.documentApproval?.needFixture, false);
    await qf({ action: "REVOKE", ...await versionInput(draft.id), reason: "图纸数据复核" }, quality);
    await assert.rejects(print, /审核|停用/);
    await assert.rejects(() => confirmWorkOrderTravelerPrints({ printIds: [latestPrint.printId], userId: planner.id, actor: planner.username }), /审核|停用/);
  });
  await t.test("late approval cannot replace a newer reviewed revision, including after revocation", async () => {
    const draft = (revision: string) => qf({ action: "SAVE_PACKAGE", libraryItemId: product.id, revision, needFixture: false, drawingFileIds: [product.files[0].id] });
    const older = await draft("C-early");
    await qf({ action: "SUBMIT", ...await versionInput(older.id) }); await review(older.id, supervisor);
    const newer = await draft("D-current");
    await qf({ action: "SUBMIT", ...await versionInput(newer.id) }); await review(newer.id, supervisor); await review(newer.id, quality);
    await assert.rejects(() => review(older.id, quality), /更新的资料版本/);
    assert.equal((await assertFixturePrintReady(prisma, order.id)).packageId, newer.id);
    await qf({ action: "REVOKE", ...await versionInput(newer.id), reason: "核对新版本适用范围" }, quality);
    await assert.rejects(() => review(older.id, quality), /更新的资料版本/);
    await qf({ action: "RETURN", ...await versionInput(older.id), reason: "已有更新版本，旧稿停止审批" }, quality);
    assert.equal((await packageRow(older.id)).status, "RETURNED");
  });
  await t.test("library replenishment and repair retain SKU identity and immutable reviewed drawings", async () => {
    await assert.rejects(() => prisma.$transaction(tx => assertFixtureDrawingMutable(tx, product.id, product.files[0].id)), /不能删除/);
    const replenishment = { action: "CREATE_FIXTURE_PURCHASE", fixtureId: m.fixtureId, quantity: 2, estimateCents: 2000, needDate: date, reason: "公共治具库补充备用" };
    const key = randomUUID();
    const purchase = await pc(replenishment, buyer, key);
    assert.deepEqual(await pc(replenishment, buyer, key), purchase);
    const line = await prisma.pcLine.findUniqueOrThrow({ where: { id: purchase.lineIds[0] }, include: { request: true } });
    assert.equal(line.fixturePackageId, null); assert.equal(line.fixtureId, m.fixtureId); assert.equal(line.request.source, "FIXTURE");
    const stockEntry = async () => { const b = await prisma.pcStockBalance.findUniqueOrThrow({ where: { id: stockId } }); return { id: b.id, version: b.version }; };
    await qf({ action: "STOCK", kind: "REPAIR", ...await stockEntry(), quantity: 2, source: "HELD", reason: "针脚损坏送修" });
    let b = await prisma.pcStockBalance.findUniqueOrThrow({ where: { id: stockId } }); assert.equal(b.repair, 2);
    await qf({ action: "STOCK", kind: "REPAIRED", ...await stockEntry(), quantity: 2, reason: "维修返回待验证" });
    b = await prisma.pcStockBalance.findUniqueOrThrow({ where: { id: stockId } }); assert.equal(b.repair, 0); assert.equal(b.held, 5);
    await assert.rejects(() => qf({ action: "STOCK", kind: "VERIFY", id: b.id, version: b.version, quantity: 1, reason: "未确认导通" }), /导通|验证/);
  });
  await prisma.$disconnect();
});
