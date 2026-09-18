import { createHash } from "node:crypto";
import { Prisma, type QfPackage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createSystemNotification } from "@/lib/system-notifications";
import type { PcActor } from "@/lib/purchasing-service";
import { pcChoice, pcDate, pcIds, pcInt, pcRecord, pcText, pcVersion, type PcInput } from "@/lib/purchasing-domain";
import { confirmBomRows, fixtureAvailable, fixtureKey, fixtureRequirements, scanBom, FixtureError,
  type BomMapping, type BomRow, type BomSheet, type DrawingEvidence } from "@/lib/quality-fixture-domain";

type Tx = Prisma.TransactionClient;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k, canonical(v)]));
  return value;
}
export function documentFingerprint(input: {
  revision: string; needFixture: boolean | null; drawingFiles: unknown; bomFileId: string | null;
  bomRows: unknown; bomMapping?: unknown; parallelCount: number; spareCount: number;
}) {
  return createHash("sha256").update(JSON.stringify(canonical([
    input.revision, input.needFixture, input.drawingFiles, input.bomFileId, input.bomRows,
    input.bomMapping ?? null, input.parallelCount, input.spareCount,
  ]))).digest("hex");
}
export const qfJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const actorName = (a: PcActor) => a.displayName || a.username;
function conflict(s: string): never { throw new FixtureError(s, "FIXTURE_CONFLICT", 409); }
function denied(s: string): never { throw new FixtureError(s, "FIXTURE_FORBIDDEN", 403); }
const nowDate = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
export const lockFixtureBusiness = (tx: Tx) => tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended('hongmeng-purchasing-v1',0))");
export async function assertFixtureDrawingMutable(tx: Tx, libraryItemId: string, fileId: string) {
  await lockFixtureBusiness(tx);
  const packages = await tx.qfPackage.findMany({ where: { libraryItemId, status: { not: "DRAFT" } }, select: { drawingFiles: true } });
  if (packages.some(p => (p.drawingFiles as unknown as DrawingEvidence[]).some(f => f.id === fileId)))
    conflict("该图纸已进入资料审核履历，不能删除或移动分类。请上传新版本并重新审核。");
}
async function event(tx: Tx, a: PcActor, type: string, id: string, action: string, snapshot: unknown, reason = "") {
  await tx.qfEvent.create({ data: { entityType: type, entityId: id, action, actorId: a.id, actorName: actorName(a), snapshot: qfJson(snapshot), reason } });
}
export async function qfSerial(tx: Tx, prefix: string) {
  const key = prefix + nowDate().replaceAll("-", "");
  const sequence = await tx.pcSequence.upsert({ where: { id: key }, create: { id: key, value: 1 }, update: { value: { increment: 1 } } });
  return key + String(sequence.value).padStart(5, "0");
}
async function users(tx: Tx, ids: string[]) {
  const valid = await tx.user.findMany({ where: { id: { in: ids }, isActive: true, accountStatus: "ACTIVE" }, select: { id: true } });
  if (valid.length !== ids.length) throw new FixtureError("所选负责人不存在或账号已停用");
}
async function settings(tx: Tx) {
  const s = await tx.qfSettings.findUnique({ where: { id: "quality-fixtures" } });
  if (!s) throw new FixtureError("请先配置主管初审和质量复审负责人", "FIXTURE_SETUP", 409);
  return s;
}
async function responsible(tx: Tx, a: PcActor, role: "supervisorIds" | "qualityIds") {
  const s = await settings(tx);
  if (!s[role].includes(a.id)) denied(role === "supervisorIds" ? "请由指定主管完成初审" : "请由指定质量人员完成复审");
}
async function closeTodos(tx: Tx, id: string) {
  await tx.systemNotificationRecipient.updateMany({ where: { notification: { sourceType: "QUALITY_FIXTURE", sourceId: id }, completedAt: null },
    data: { completedAt: new Date(), completionKind: "SOURCE_RESOLVED", completionReason: "资料审核环节已推进" } });
}
async function notify(tx: Tx, a: PcActor, p: QfPackage, ids: string[], title: string) {
  const active = await tx.user.findMany({ where: { id: { in: [...new Set(ids)] }, isActive: true, accountStatus: "ACTIVE" }, select: { id: true } });
  await createSystemNotification(tx, { eventType: "QUALITY_FIXTURE_" + p.status,
    dedupeKey: "qf:" + p.id + ":" + p.version, category: "TODO", title, sourceType: "QUALITY_FIXTURE", sourceId: p.id,
    actorId: a.id, targetRoute: "/workspace/quality-fixtures?view=review&product=" + p.libraryItemId + "&package=" + p.id,
    recipientUserIds: active.map(u => u.id) });
}
async function getPackage(tx: Tx, id: unknown, version?: unknown) {
  const p = await tx.qfPackage.findUnique({ where: { id: pcText(id, "资料版本", 100) }, include: { libraryItem: true } });
  if (!p || p.libraryItem.deletedAt) throw new FixtureError("资料版本不存在或产品已归档", "FIXTURE_NOT_FOUND", 404);
  if (version !== undefined) pcVersion(p.version, version);
  return p;
}
export async function assertPackageFiles(tx: Tx, p: QfPackage) {
  const evidence = p.drawingFiles as unknown as DrawingEvidence[];
  if (!Array.isArray(evidence) || !evidence.length || p.needFixture === null) conflict("图纸或治具选项尚未完整");
  const files = await tx.drawingLibraryFile.findMany({ where: { id: { in: evidence.map(f => f.id) }, libraryItemId: p.libraryItemId, deletedAt: null } });
  if (files.length !== evidence.length || evidence.some(e => !files.some(f => f.id === e.id && f.objectKey === e.objectKey && f.version === e.version && (f.sha256 || "") === e.sha256)))
    conflict("审核所引用图纸已移除或发生变化，请重新提交资料");
  if (p.needFixture) {
    const bom = p.bomFileId && await tx.qfBomFile.findFirst({ where: { id: p.bomFileId, libraryItemId: p.libraryItemId, deletedAt: null } });
    if (!bom || !p.bomConfirmed || !(p.bomRows as unknown as BomRow[]).some(r => r.include)) conflict("请上传 BOM 并确认连接器清单");
  }
  if (p.fingerprint !== documentFingerprint(p)) conflict("受审资料指纹发生变化，请重新提交审核");
}
export async function fixtureReadiness(tx: Tx, p: QfPackage | null, workOrderId = "") {
  if (!p || p.needFixture === null) return { label: "治具要求待确认", missing: 0, unmatched: 0, groups: [], unmatchedRows: [] };
  if (!p.needFixture) return { label: "无需治具", missing: 0, unmatched: 0, groups: [], unmatchedRows: [] };
  const needs = fixtureRequirements(p.bomRows as unknown as BomRow[], p.parallelCount, p.spareCount);
  const mappings = await tx.qfMapping.findMany({ where: { active: true, preferred: true, fixture: { active: true },
    connector: { OR: needs.map(n => ({ model: n.model, manufacturer: n.manufacturer })) } },
    include: { connector: true, fixture: { include: { item: { include: { balances: { include: { holdings: true } } } } } } }, orderBy: { confirmedAt: "desc" } });
  const unmatchedRows = needs.filter(n => !mappings.some(m => fixtureKey(m.connector.model, m.connector.manufacturer) === n.key));
  const grouped = new Map<string, { fixture: typeof mappings[number]["fixture"]; perUnit: number; models: string[]; mappingIds: string[] }>();
  for (const need of needs) {
    const matches = mappings.filter(m => fixtureKey(m.connector.model, m.connector.manufacturer) === need.key);
    if (matches.length !== 1) { if (matches.length > 1) unmatchedRows.push(need); continue; }
    const m = matches[0];
    if ((m.fixture.unit === "套") !== (need.unit === "套")) { unmatchedRows.push(need); continue; }
    const group = grouped.get(m.fixtureId) || { fixture: m.fixture, perUnit: 0, models: [], mappingIds: [] };
    group.perUnit += need.perUnit; group.models.push(need.model); group.mappingIds.push(m.id); grouped.set(m.fixtureId, group);
  }
  const groups = await Promise.all([...grouped.values()].map(async g => {
    const required = g.perUnit * p.parallelCount + p.spareCount;
    const available = g.fixture.item.balances.reduce((n, b) => n + fixtureAvailable(b), 0);
    const assigned = g.fixture.item.balances.flatMap(b => b.holdings)
      .filter(h => h.libraryItemId === p.libraryItemId && h.workOrderId === workOrderId)
      .reduce((n, h) => n + h.reserved + h.issued, 0);
    const open = await tx.pcLine.findMany({ where: { fixtureId: g.fixture.id, fixturePackageId: p.id, status: { in: ["PENDING", "APPROVED", "ORDERED"] }, request: { deletedAt: null } } });
    const incoming = open.reduce((n, l) => n + Math.max(0, l.quantity - l.receivedQty - l.cancelledQty), 0);
    return { fixtureId: g.fixture.id, number: g.fixture.number, model: g.fixture.model, name: g.fixture.name, unit: g.fixture.unit,
      assemblyRequired: g.fixture.assemblyRequired, required, available, assigned, incoming, shortage: Math.max(0, required - available - assigned),
      connectorModels: g.models, mappingIds: g.mappingIds };
  }));
  const missing = groups.reduce((n, g) => n + g.shortage, 0);
  return { label: unmatchedRows.length ? unmatchedRows.length + " 项待匹配" : missing ? "治具缺 " + missing : groups.length ? "当前库存满足" : "BOM 待确认",
    missing, unmatched: unmatchedRows.length, groups, unmatchedRows };
}
export async function assertFixturePrintReady(tx: Tx, workOrderId: string, expectedPackageId?: string) {
  const wo = await tx.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true, code: true, drawingLibraryItemId: true, fixtureBinding: true } });
  if (!wo?.drawingLibraryItemId) conflict((wo?.code || "工单") + "尚未关联产品图纸资料，请先补齐并完成两级审核");
  if (!await tx.drawingLibraryItem.findFirst({ where: { id: wo!.drawingLibraryItemId!, deletedAt: null } })) conflict("产品图纸档案已归档");
  if (expectedPackageId && wo!.fixtureBinding && expectedPackageId !== wo!.fixtureBinding.packageId) conflict("计划指定资料版本已变化，请重新生成工单");
  const p = expectedPackageId
    ? await tx.qfPackage.findUnique({ where: { id: expectedPackageId } })
    : wo!.fixtureBinding ? await tx.qfPackage.findUnique({ where: { id: wo!.fixtureBinding.packageId } })
      : await tx.qfPackage.findFirst({ where: { libraryItemId: wo!.drawingLibraryItemId!, status: "APPROVED" }, orderBy: { sequence: "desc" } });
  if (!p || p.libraryItemId !== wo!.drawingLibraryItemId || !(p.status === "APPROVED" || (p.status === "SUPERSEDED" && p.continuedWorkOrderIds.includes(workOrderId))))
    conflict(wo!.code + "适用资料未完成主管初审和质量复审，或该版本已停用");
  if (!p.supervisorId || !p.qualityId || p.supervisorId === p.qualityId || p.submittedById === p.supervisorId || p.submittedById === p.qualityId)
    conflict("资料审核签名无效，请重新完成独立两级审核");
  await assertPackageFiles(tx, p);
  const readiness = await fixtureReadiness(tx, p, workOrderId);
  return { packageId: p.id, revision: p.revision, sequence: p.sequence, fingerprint: p.fingerprint,
    supervisor: p.supervisorName, supervisorAt: p.supervisorAt?.toISOString(), quality: p.qualityName, qualityAt: p.qualityAt?.toISOString(),
    needFixture: p.needFixture, bomFileId: p.bomFileId, fixtureLabel: readiness.label,
    drawingFiles: p.drawingFiles as unknown as DrawingEvidence[] };
}
async function savePackage(tx: Tx, input: PcInput, a: PcActor) {
  const libraryItemId = pcText(input.libraryItemId, "产品档案", 100);
  const product = await tx.drawingLibraryItem.findFirst({ where: { id: libraryItemId, deletedAt: null } });
  if (!product) throw new FixtureError("产品图纸档案不存在");
  const old = input.id ? await getPackage(tx, input.id, input.version) : null;
  if (old && old.libraryItemId !== libraryItemId) conflict("不能变更资料包所属产品");
  const ids = Array.isArray(input.drawingFileIds) && input.drawingFileIds.length ? pcIds(input.drawingFileIds, "图纸") : [];
  const files = await tx.drawingLibraryFile.findMany({ where: { id: { in: ids }, libraryItemId, deletedAt: null, category: { code: "drawing" } }, orderBy: { id: "asc" } });
  if (files.length !== ids.length) throw new FixtureError("所选图纸不存在或不属于该产品");
  const need = typeof input.needFixture === "boolean" ? input.needFixture : null;
  const bomFileId = need && input.bomFileId ? pcText(input.bomFileId, "BOM", 100) : null;
  const bom = bomFileId ? await tx.qfBomFile.findFirst({ where: { id: bomFileId, libraryItemId, deletedAt: null } }) : null;
  if (bomFileId && !bom) throw new FixtureError("BOM 不存在或不属于该产品");
  const confirmed = need && !!bom && input.bomConfirmed === true;
  const mapping = bom ? pcRecord(input.bomMapping) as unknown as BomMapping : null;
  const base = bom && mapping ? scanBom(bom.sheets as unknown as BomSheet[], mapping) : [];
  const rows = confirmed ? confirmBomRows(base, input.bomRows) : base;
  const values = { revision: pcText(input.revision, "图纸版本", 40), needFixture: need,
    parallelCount: pcInt(input.parallelCount ?? 1, "同时测试产品数量", 1, 1000), spareCount: pcInt(input.spareCount ?? 0, "每种对插件备用数量", 0, 10000),
    drawingFiles: qfJson(files.map(f => ({ id: f.id, name: f.displayName || f.originalName, version: f.version, sha256: f.sha256 || "", objectKey: f.objectKey, mimeType: f.mimeType }))),
    bomFileId, bomMapping: mapping ? qfJson(mapping) : Prisma.JsonNull, bomRows: qfJson(rows), bomConfirmed: !!confirmed, status: "DRAFT", reason: "" };
  const fingerprint = documentFingerprint({ ...values, bomMapping: mapping });
  let p: QfPackage;
  if (old?.status === "DRAFT") p = await tx.qfPackage.update({ where: { id: old.id }, data: { ...values, fingerprint, version: { increment: 1 } } });
  else {
    const last = await tx.qfPackage.findFirst({ where: { libraryItemId }, orderBy: { sequence: "desc" } });
    p = await tx.qfPackage.create({ data: { ...values, fingerprint, libraryItemId, sequence: (last?.sequence || 0) + 1, createdById: a.id } });
  }
  await event(tx, a, "PACKAGE", p.id, "SAVE", { before: old, after: p });
  return p;
}
async function submitPackage(tx: Tx, input: PcInput, a: PcActor) {
  const p = await getPackage(tx, input.id, input.version), s = await settings(tx);
  if (p.status !== "DRAFT") conflict("请先建立资料修订草稿，再提交主管初审");
  await assertPackageFiles(tx, p);
  if (!s.supervisorIds.some(id => id !== a.id) || !s.qualityIds.some(id => id !== a.id)) conflict("负责人设置无法完成独立审核，请配置上传人以外的主管和质量人员");
  const result = await tx.qfPackage.update({ where: { id: p.id }, data: { status: "SUPERVISOR", version: { increment: 1 }, submittedById: a.id, submittedByName: actorName(a), submittedAt: new Date() } });
  await event(tx, a, "PACKAGE", p.id, "SUBMIT", result);
  await notify(tx, a, result, s.supervisorIds.filter(id => id !== a.id), "生产资料待主管初审 · " + p.libraryItem.specification);
  return { id: result.id, version: result.version };
}
async function review(tx: Tx, input: PcInput, a: PcActor) {
  const p = await getPackage(tx, input.id, input.version);
  if (!["SUPERVISOR", "QUALITY"].includes(p.status)) conflict("该版本当前不在待审核状态");
  await responsible(tx, a, p.status === "SUPERVISOR" ? "supervisorIds" : "qualityIds");
  if (p.submittedById === a.id || (p.status === "QUALITY" && p.supervisorId === a.id)) denied("上传人不能自审，主管与质量复审须由不同账号完成");
  const approve = input.action === "APPROVE";
  if (approve) {
    if (await tx.qfPackage.count({ where: { libraryItemId: p.libraryItemId, sequence: { gt: p.sequence }, qualityAt: { not: null } } }))
      conflict("已有更新的资料版本完成质量复审，不能再批准这份旧稿。请退回旧稿，或基于所需资料新建修订版本。");
    const ids = (p.drawingFiles as unknown as DrawingEvidence[]).map(f => f.id);
    const ownsDrawing = await tx.drawingLibraryFile.count({ where: { id: { in: ids }, uploadedById: a.id } });
    const ownsBom = p.bomFileId && await tx.qfBomFile.count({ where: { id: p.bomFileId, uploadedById: a.id } });
    if (ownsDrawing || ownsBom) denied("不能审核自己上传的图纸或 BOM，请由其他指定审核人员处理");
    if (input.confirmed !== true) throw new FixtureError("请确认已核对图纸、资料完整性和连接器清单");
  }
  const reason = pcText(input.reason, "退回意见", 2000, !approve);
  if (approve) await assertPackageFiles(tx, p);
  const next = !approve ? "RETURNED" : p.status === "SUPERVISOR" ? "QUALITY" : "APPROVED";
  if (next === "APPROVED") await tx.qfPackage.updateMany({ where: { libraryItemId: p.libraryItemId, status: "APPROVED", id: { not: p.id } }, data: { status: "SUPERSEDED", version: { increment: 1 } } });
  const result = await tx.qfPackage.update({ where: { id: p.id }, data: { status: next, reason, version: { increment: 1 },
    ...(approve ? p.status === "SUPERVISOR" ? { supervisorId: a.id, supervisorName: actorName(a), supervisorAt: new Date() } : { qualityId: a.id, qualityName: actorName(a), qualityAt: new Date() } : {}) } });
  await event(tx, a, "PACKAGE", p.id, String(input.action), { before: p.status, after: result }, reason);
  await closeTodos(tx, p.id);
  const s = await settings(tx);
  await notify(tx, a, result, next === "QUALITY" ? s.qualityIds.filter(id => id !== p.submittedById && id !== a.id) : [p.submittedById!],
    (next === "QUALITY" ? "生产资料待质量复审" : next === "APPROVED" ? "生产资料两级审核完成" : "生产资料已退回") + " · " + p.libraryItem.specification);
  return { id: result.id, version: result.version };
}
async function saveMapping(tx: Tx, input: PcInput, a: PcActor) {
  const model = pcText(input.connectorModel, "产品连接器完整型号", 200), manufacturer = pcText(input.connectorManufacturer, "制造商", 100, false);
  const connector = await tx.qfConnector.upsert({ where: { model_manufacturer: { model, manufacturer } }, create: { model, manufacturer, name: pcText(input.connectorName, "连接器名称", 200, false) }, update: {} });
  const evidence = pcText(input.evidence, "对插规格确认依据", 1000);
  let fixture = input.fixtureId ? await tx.qfFixture.findUnique({ where: { id: pcText(input.fixtureId, "对插件", 100) } }) : null;
  if (input.fixtureId && !fixture?.active) throw new FixtureError("所选对插件不存在或已停用");
  if (!fixture) {
    const mateModel = pcText(input.model, "对插件完整型号", 200), maker = pcText(input.manufacturer, "对插件制造商", 100, false);
    fixture = await tx.qfFixture.findUnique({ where: { model_manufacturer: { model: mateModel, manufacturer: maker } } });
    if (!fixture) {
      const number = await qfSerial(tx, "TJ"), name = pcText(input.name, "对插件名称", 200), unit = pcChoice(input.unit || "个", ["个", "套", "件"], "单位");
      const item = await tx.pcItem.create({ data: { number, name, spec: mateModel, unit, category: "导通治具" } });
      fixture = await tx.qfFixture.create({ data: { number, name, model: mateModel, manufacturer: maker, itemId: item.id, unit, assemblyRequired: input.assemblyRequired === true } });
    }
  }
  if (!fixture.active) conflict("该对插件已停用，请先核对状态");
  await tx.qfMapping.updateMany({ where: { connectorId: connector.id, active: true, preferred: true }, data: { preferred: false, version: { increment: 1 } } });
  const mapping = await tx.qfMapping.create({ data: { connectorId: connector.id, fixtureId: fixture.id, evidence, scope: pcText(input.scope, "适用范围", 1000, false), confirmedById: a.id, confirmedByName: actorName(a) } });
  await event(tx, a, "MAPPING", mapping.id, "CONFIRM_SPECIFICATION", { connector, fixture, mapping });
  return { id: mapping.id, fixtureId: fixture.id };
}
export async function createFixturePurchase(tx: Tx, input: PcInput, a: PcActor) {
  const p = input.packageId ? await getPackage(tx, input.packageId) : null;
  if (p && (["REVOKED", "SUPERSEDED", "RETURNED"].includes(p.status) || !p.needFixture || !p.bomConfirmed))
    conflict("请先确认有效资料版本中的连接器需求，再发起治具申购");
  if (p && input.version !== undefined) pcVersion(p.version, input.version);
  if (p) await assertPackageFiles(tx, p);
  const readiness = p ? await fixtureReadiness(tx, p) : null;
  const group = readiness?.groups.find(g => g.fixtureId === input.fixtureId);
  if (p && !group) throw new FixtureError("该对插件不是本版本已确认的治具需求");
  const quantity = pcInt(input.quantity, "申购数量", 1, 1000000), estimateCents = pcInt(input.estimateCents, "预算合计（分）", 1);
  if (group) {
    const incremental = Math.max(0, group.shortage - group.incoming);
    if (quantity > incremental) conflict("现有库存和未结束申购已覆盖部分需求，本次最多新增 " + incremental + " " + group.unit);
  }
  const pc = await tx.pcSettings.findUnique({ where: { id: "purchasing" } });
  if (!pc) conflict("请先配置采购流程负责人");
  const fixture = await tx.qfFixture.findFirst({ where: { id: pcText(input.fixtureId, "对插件", 100), active: true, mappings: { some: { active: true, preferred: true } } } });
  if (!fixture) throw new FixtureError("请先确认对插件与连接器的有效匹配关系");
  const reason = p ? "" : pcText(input.reason, "治具库补充申购用途", 1000);
  const request = await tx.pcRequest.create({ data: { source: "FIXTURE", number: await qfSerial(tx, "TJCG"), status: "PENDING",
    applicantId: a.id, applicantName: actorName(a), submitterId: a.id, submitterName: actorName(a),
    purpose: p ? "导通治具 · " + p.libraryItem.specification + " · 资料 " + p.revision : "治具库补充申购 · " + reason } });
  const line = await tx.pcLine.create({ data: { requestId: request.id, number: request.number + "-01", name: fixture.name, spec: fixture.model, unit: fixture.unit,
    category: "导通治具", needDate: pcDate(input.needDate, "需求日期"), urgency: pcChoice(input.urgency || "NORMAL", ["NORMAL", "URGENT", "CRITICAL"], "紧急程度"),
    quantity, estimateCents, status: "PENDING", itemId: fixture.itemId, fixtureId: fixture.id, fixturePackageId: p?.id,
    fixtureBasis: qfJson(p && group ? { packageId: p.id, fingerprint: p.fingerprint, mappings: group.mappingIds, connectors: group.connectorModels, required: group.required } :
      { mode: "LIBRARY_REPLENISHMENT", fixtureId: fixture.id, model: fixture.model, reason, quantity }) } });
  await tx.pcEvent.create({ data: { entityType: "LINE", entityId: line.id, action: "SUBMIT", actorId: a.id, actorName: actorName(a), snapshot: qfJson(line) } });
  await event(tx, a, p ? "PACKAGE" : "FIXTURE", p?.id || fixture.id, "CREATE_PURCHASE", { requestId: request.id, lineId: line.id, fixtureId: fixture.id, quantity });
  await createSystemNotification(tx, { eventType: "PURCHASING_FIXTURE_SUBMIT", dedupeKey: "qf:purchase:" + line.id, category: "TODO",
    title: "【杭连采购】治具申购待审批 · " + fixture.model, sourceType: "PURCHASING", sourceId: line.id, actorId: a.id,
    targetRoute: "/workspace/purchases?source=FIXTURE&view=approval&record=" + line.id, recipientUserIds: pc.purchaseApproverIds });
  return { id: request.id, lineIds: [line.id], duplicates: [] };
}
export async function mutateQualityFixture(input: PcInput, a: PcActor, key: unknown) {
  const operationKey = "qf:" + pcText(key, "操作标识", 150), hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return prisma.$transaction(async tx => {
    await lockFixtureBusiness(tx);
    const done = await tx.pcOperation.findUnique({ where: { id: operationKey } });
    if (done) { if (done.actorId !== a.id || done.payloadHash !== hash) conflict("操作标识已被其他请求使用"); return done.result; }
    const action = pcText(input.action, "操作", 60);
    let result: unknown;
    if (action === "SAVE_SETTINGS") {
      const old = await tx.qfSettings.findUnique({ where: { id: "quality-fixtures" } });
      if (old) { if (old.ownerId !== a.id && a.laborRole !== "ADMIN") denied("只有审核流程维护人可以更改负责人"); pcVersion(old.version, input.version); }
      const supervisors = pcIds(input.supervisorIds, "主管"), qualities = pcIds(input.qualityIds, "质量人员");
      if (supervisors.some(id => qualities.includes(id))) throw new FixtureError("主管和质量负责人不能重叠");
      await users(tx, [...supervisors, ...qualities]);
      result = await tx.qfSettings.upsert({ where: { id: "quality-fixtures" }, create: { ownerId: a.id, supervisorIds: supervisors, qualityIds: qualities },
        update: { supervisorIds: supervisors, qualityIds: qualities, version: { increment: 1 } } });
      await event(tx, a, "SETTINGS", "quality-fixtures", action, { before: old, after: result });
    } else if (action === "SAVE_PACKAGE") result = await savePackage(tx, input, a);
    else if (action === "SUBMIT") result = await submitPackage(tx, input, a);
    else if (action === "APPROVE" || action === "RETURN") result = await review(tx, input, a);
    else if (action === "SAVE_MAPPING") result = await saveMapping(tx, input, a);
    else if (action === "REVOKE" || action === "CONTINUE_OLD_VERSION") {
      const p = await getPackage(tx, input.id, input.version);
      await responsible(tx, a, "qualityIds");
      const reason = pcText(input.reason, "版本处理原因", 2000);
      if (!["APPROVED", "SUPERSEDED"].includes(p.status)) conflict("只有已批准或被替代版本可以执行此操作");
      if (action === "REVOKE") {
        result = await tx.qfPackage.update({ where: { id: p.id }, data: { status: "REVOKED", reason, continuedWorkOrderIds: [], version: { increment: 1 } } });
      } else {
        const ids = pcIds(input.workOrderIds, "允许沿用的在制工单");
        const orders = await tx.workOrder.count({ where: { id: { in: ids }, drawingLibraryItemId: p.libraryItemId, deletedAt: null } });
        if (orders !== ids.length) throw new FixtureError("沿用范围中存在其他产品或已删除工单");
        result = await tx.qfPackage.update({ where: { id: p.id }, data: { continuedWorkOrderIds: ids, reason, version: { increment: 1 } } });
      }
      await event(tx, a, "PACKAGE", p.id, action, result, reason);
      await closeTodos(tx, p.id);
    } else if (action === "BIND_WORK_ORDERS") {
      const p = await getPackage(tx, input.packageId), ids = pcIds(input.workOrderIds, "工单");
      if (["REVOKED", "SUPERSEDED"].includes(p.status)) conflict("不能给新计划指定停用版本");
      if (await tx.workOrder.count({ where: { id: { in: ids }, drawingLibraryItemId: p.libraryItemId, deletedAt: null } }) !== ids.length)
        throw new FixtureError("只能关联同一产品的有效工单");
      for (const workOrderId of ids) await tx.qfPlanBinding.upsert({ where: { workOrderId }, create: { workOrderId, packageId: p.id, selectedById: a.id },
        update: { packageId: p.id, selectedById: a.id, selectedAt: new Date() } });
      result = { count: ids.length };
      await event(tx, a, "PACKAGE", p.id, action, { workOrderIds: ids });
    } else if (action === "SAVE_TEMPLATE") {
      const name = pcText(input.name, "模板名称", 100), mapping = qfJson(pcRecord(input.mapping));
      result = await tx.qfBomTemplate.upsert({ where: { name }, create: { name, mapping, updatedById: a.id }, update: { mapping, updatedById: a.id } });
    } else if (action === "STOCK") {
      const { moveFixtureStock } = await import("@/lib/quality-fixture-stock");
      result = await moveFixtureStock(tx, input, a);
    } else throw new FixtureError("不支持的治具操作");
    const saved = qfJson(result);
    await tx.pcOperation.create({ data: { id: operationKey, actorId: a.id, payloadHash: hash, result: saved } });
    return saved;
  }, { maxWait: 30000, timeout: 30000 });
}
