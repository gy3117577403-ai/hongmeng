import { fixtureSubmissionIssues } from "@/lib/quality-fixture-documents";
import { getFixturePreparation, saveFixturePreparation } from "@/lib/quality-fixture-preparation";
import { createHash } from "node:crypto";
import { Prisma, type QfPackage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requiresDocumentReview } from "@/lib/quality-fixture-scope";
import { createSystemNotification } from "@/lib/system-notifications";
import type { PcActor } from "@/lib/purchasing-service";
import { pcChoice, pcDate, pcIds, pcInt, pcRecord, pcText, pcVersion, type PcInput } from "@/lib/purchasing-domain";
import { confirmBomRows, fixtureAvailable, fixtureRequirements, scanBom, FixtureError, fixtureReviewRoles, fixtureSignaturesValid, QF_REVIEW_STATUSES,
  type BomMapping, type BomRow, type BomSheet, type DrawingEvidence } from "@/lib/quality-fixture-domain";

type Tx = Prisma.TransactionClient;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k, canonical(v)]));
  return value;
}
export function documentFingerprint(input: {
  revision: string; needFixture: boolean | null; drawingFiles: unknown; bomFileId: string | null;
  bomRows: unknown; bomMapping?: unknown; parallelCount: number; spareCount: number; sopFiles?: unknown;
}) {
  return createHash("sha256").update(JSON.stringify(canonical([
    input.revision, input.needFixture, input.drawingFiles, input.bomFileId, input.bomRows,
    input.bomMapping ?? null, input.parallelCount, input.spareCount, input.sopFiles ?? [],
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
  const packages = await tx.qfPackage.findMany({ where: { libraryItemId, status: { not: "DRAFT" } }, select: { drawingFiles: true, sopFiles: true } });
  if (packages.some(p => [...p.drawingFiles as unknown as DrawingEvidence[], ...p.sopFiles as unknown as DrawingEvidence[]].some(f => f.id === fileId)))
    conflict("该文件已进入资料审核履历，不能删除或移动分类。请上传新版本并重新审核。");
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
  return s || { supervisorIds: [] as string[], qualityIds: [] as string[] };
}
async function responsible(tx: Tx, a: PcActor, role: "supervisorIds" | "qualityIds") {
  const s = await settings(tx);
  if (a.laborRole !== "ADMIN" && !s[role].includes(a.id)) denied(role === "supervisorIds" ? "请由指定主管或管理员审核" : "请由指定品质人员或管理员审核");
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
export async function pendingReviewers(tx: Tx, p: QfPackage) {
  const s = await settings(tx);
  const people = await tx.user.findMany({ where: { isActive: true, accountStatus: "ACTIVE",
    OR: [{ laborRole: "ADMIN" }, { id: { in: [...s.supervisorIds, ...s.qualityIds] } }] } });
  const files = [...p.drawingFiles as unknown as DrawingEvidence[], ...p.sopFiles as unknown as DrawingEvidence[]];
  const uploads = await tx.drawingLibraryFile.findMany({ where: { id: { in: files.map(f => f.id) } }, select: { uploadedById: true } });
  return people.map(person => ({ id: person.id, roles: fixtureReviewRoles(p, person, s,
    uploads.some(f => f.uploadedById === person.id)) }));
}
async function notifyPendingReviews(tx: Tx, a: PcActor, p: QfPackage, specification: string) {
  const recipients = await pendingReviewers(tx, p);
  await notify(tx, a, p, recipients.filter(r => r.roles.length).map(r => r.id),
    (p.status === "REVIEWING" ? "生产资料待主管、品质审核（顺序不限）" : p.status === "SUPERVISOR" ? "生产资料待主管审核" : "生产资料待品质审核") + " · " + specification);
}
async function getPackage(tx: Tx, id: unknown, version?: unknown) {
  const p = await tx.qfPackage.findUnique({ where: { id: pcText(id, "资料版本", 100) }, include: { libraryItem: true } });
  if (!p || p.libraryItem.deletedAt) throw new FixtureError("资料版本不存在或产品已归档", "FIXTURE_NOT_FOUND", 404);
  if (version !== undefined) pcVersion(p.version, version);
  return p;
}
export async function assertPackageFiles(tx: Tx, p: QfPackage) {
  const drawings = p.drawingFiles as unknown as DrawingEvidence[], sops = p.sopFiles as unknown as DrawingEvidence[];
  const issues = fixtureSubmissionIssues({ ...p, needFixture: false });
  if (issues.length) conflict(issues.join("；"));
  const evidence = [...(Array.isArray(drawings) ? drawings : []), ...(Array.isArray(sops) ? sops : [])];
  const files = await tx.drawingLibraryFile.findMany({ where: { id: { in: evidence.map(f => f.id) }, libraryItemId: p.libraryItemId, deletedAt: null } });
  if (files.length !== evidence.length || evidence.some(e => !files.some(f => f.id === e.id && f.objectKey === e.objectKey && f.version === e.version && (f.sha256 || "") === e.sha256)))
    conflict("审核所引用资料已移除或发生变化，请重新提交资料");
  if (p.fingerprint !== documentFingerprint(p)) conflict("受审资料指纹发生变化，请重新提交审核");
  if (["APPROVED", "SUPERSEDED"].includes(p.status)) {
    const issues = await tx.qfDocumentReturn.findMany({ where: { libraryItemId: p.libraryItemId,
      OR: [{ sourcePackageId: p.id, kind: "package" }, { fileId: { in: evidence.map(f => f.id) } }] } });
    if (issues.some(i => i.status !== "RESOLVED" || i.kind !== "package" && i.responseFileId !== i.fileId))
      conflict("本打印版本引用了审核不通过的文件，请使用技术处理后双方通过的资料版本");
  }
}
export async function fixtureReadiness(tx: Tx, source: { libraryItemId: string } | null, workOrderId = "") {
  const empty = { calculated: false, missing: 0, unmatched: 0, groups: [], unmatchedRows: [] };
  const product = source && await tx.drawingLibraryItem.findUnique({ where: { id: source.libraryItemId }, select: { fixtureRequired: true } });
  if (!source || product?.fixtureRequired === null) return { ...empty, label: "治具要求待确认" };
  if (!product?.fixtureRequired) return { ...empty, label: "无需治具" };
  const p = await getFixturePreparation(tx, source.libraryItemId);
  if (!p.bomFileId) return { ...empty, label: "BOM 待上传 · 需求尚未计算" };
  if (!await tx.qfBomFile.findFirst({ where: { id: p.bomFileId, libraryItemId: p.libraryItemId, deletedAt: null } })) return { ...empty, label: "BOM 原件待补 · 需求尚未计算" };
  if (!p.bomConfirmed || !(p.bomRows as unknown as BomRow[]).some(r => r.include)) return { ...empty, label: "BOM 待确认 · 需求尚未计算" };
  const needs = fixtureRequirements(p.bomRows as unknown as BomRow[], p.parallelCount, p.spareCount);
  const mappings = await tx.qfMapping.findMany({ where: { active: true, preferred: true, fixture: { active: true },
    connector: { model: { in: needs.map(n => n.model) } } },
    include: { connector: true, fixture: { include: { item: { include: { balances: { include: { holdings: true } } } } } } }, orderBy: { confirmedAt: "desc" } });
  const unmatchedRows = needs.filter(n => !mappings.some(m => m.connector.model === n.model));
  const grouped = new Map<string, { fixture: typeof mappings[number]["fixture"]; perUnit: number; models: string[]; mappingIds: string[] }>();
  for (const need of needs) {
    const matches = mappings.filter(m => m.connector.model === need.model);
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
    const open = await tx.pcLine.findMany({ where: { fixtureId: g.fixture.id,
      OR: [{ fixturePackage: { libraryItemId: p.libraryItemId } }, { fixtureBasis: { path: ["libraryItemId"], equals: p.libraryItemId } }],
      status: { in: ["PENDING", "APPROVED", "ORDERED"] }, request: { deletedAt: null, source: "FIXTURE" } } });
    const incoming = open.reduce((n, l) => n + Math.max(0, l.quantity - l.receivedQty - l.cancelledQty), 0);
    return { fixtureId: g.fixture.id, number: g.fixture.number, model: g.fixture.model, name: g.fixture.name, unit: g.fixture.unit,
      assemblyRequired: g.fixture.assemblyRequired, required, available, assigned, incoming, shortage: Math.max(0, required - available - assigned),
      connectorModels: g.models, mappingIds: g.mappingIds };
  }));
  const missing = groups.reduce((n, g) => n + g.shortage, 0);
  return { label: unmatchedRows.length ? unmatchedRows.length + " 项待匹配" : missing ? "治具缺 " + missing : groups.length ? "当前库存满足" : "BOM 待确认",
    calculated: true, missing, unmatched: unmatchedRows.length, groups, unmatchedRows };
}
export async function assertFixturePrintReady(tx: Tx, workOrderId: string, expectedPackageId?: string) {
  const wo = await tx.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true, code: true, drawingLibraryItemId: true, fixtureBinding: true, documentReviewRequired: true, weekStartDate: true } });
  if (wo && !requiresDocumentReview(wo)) return null;
  if (!wo?.drawingLibraryItemId) conflict((wo?.code || "工单") + "尚未关联产品图纸资料，请先补齐并完成两级审核");
  if (!await tx.drawingLibraryItem.findFirst({ where: { id: wo!.drawingLibraryItemId!, deletedAt: null } })) conflict("产品图纸档案已归档");
  if (expectedPackageId && wo!.fixtureBinding && expectedPackageId !== wo!.fixtureBinding.packageId) conflict("计划指定资料版本已变化，请重新生成工单");
  const p = expectedPackageId
    ? await tx.qfPackage.findUnique({ where: { id: expectedPackageId } })
    : wo!.fixtureBinding ? await tx.qfPackage.findUnique({ where: { id: wo!.fixtureBinding.packageId } })
      : await tx.qfPackage.findFirst({ where: { libraryItemId: wo!.drawingLibraryItemId! }, orderBy: { sequence: "desc" } });
  if (!p || p.libraryItemId !== wo!.drawingLibraryItemId || !(p.status === "APPROVED" || (p.status === "SUPERSEDED" && p.continuedWorkOrderIds.includes(workOrderId))))
    conflict(wo!.code + "适用资料未完成主管与品质双方审核，或该版本已停用");
  if (!fixtureSignaturesValid(p)) conflict("资料审核签名无效，主管与品质必须都审核通过");
  // New orders must not reuse approval during the asynchronous source-sync window.
  if (!wo!.fixtureBinding && p.sourceSignature && !await (await import("@/lib/quality-fixture-sync")).packageMatchesCurrentDocuments(tx, p))
    conflict("图纸或 SOP 已有更新，请完成新版双方审核后打印");
  await assertPackageFiles(tx, p);
  const readiness = await fixtureReadiness(tx, p, workOrderId);
  return { packageId: p.id, revision: p.revision, sequence: p.sequence, fingerprint: p.fingerprint,
    supervisor: p.supervisorName, supervisorAt: p.supervisorAt?.toISOString(), quality: p.qualityName, qualityAt: p.qualityAt?.toISOString(),
    needFixture: (await tx.drawingLibraryItem.findUniqueOrThrow({ where: { id: p.libraryItemId } })).fixtureRequired,
    bomFileId: (await getFixturePreparation(tx, p.libraryItemId)).bomFileId, fixtureLabel: readiness.label,
    drawingFiles: p.drawingFiles as unknown as DrawingEvidence[], sopFiles: p.sopFiles as unknown as DrawingEvidence[] };
}
export async function savePackage(tx: Tx, input: PcInput, a: PcActor) {
  const libraryItemId = pcText(input.libraryItemId, "产品档案", 100);
  const product = await tx.drawingLibraryItem.findFirst({ where: { id: libraryItemId, deletedAt: null } });
  if (!product) throw new FixtureError("产品图纸档案不存在");
  const old = input.id ? await getPackage(tx, input.id, input.version) : null;
  if (old && old.libraryItemId !== libraryItemId) conflict("不能变更资料包所属产品");
  const ids = Array.isArray(input.drawingFileIds) && input.drawingFileIds.length ? pcIds(input.drawingFileIds, "图纸") : [];
  const files = await tx.drawingLibraryFile.findMany({ where: { id: { in: ids }, libraryItemId, deletedAt: null, category: { code: "drawing" } }, orderBy: { id: "asc" } });
  if (files.length !== ids.length) throw new FixtureError("所选图纸不存在或不属于该产品");
  const sopIds = Array.isArray(input.sopFileIds) ? input.sopFileIds as string[] : null;
  const sops = await tx.drawingLibraryFile.findMany({ where: { libraryItemId, deletedAt: null, category: { code: "sop" }, ...(sopIds ? { id: { in: sopIds } } : { isCurrent: true }) }, orderBy: { id: "asc" } });
  if (sopIds && sops.length !== new Set(sopIds).size) throw new FixtureError("所选 SOP 不存在或不属于该产品");
  const need = typeof input.needFixture === "boolean" ? input.needFixture : product.fixtureRequired;
  await tx.drawingLibraryItem.update({ where: { id: libraryItemId }, data: { fixtureRequired: need } });
  if (need !== product.fixtureRequired) await event(tx, a, "PRODUCT", libraryItemId, "SET_FIXTURE_REQUIREMENT", { before: product.fixtureRequired, after: need });
  const bomFileId = need && input.bomFileId ? pcText(input.bomFileId, "BOM", 100) : null;
  const bom = bomFileId ? await tx.qfBomFile.findFirst({ where: { id: bomFileId, libraryItemId, deletedAt: null } }) : null;
  if (bomFileId && !bom) throw new FixtureError("BOM 不存在或不属于该产品");
  const confirmed = need && !!bom && input.bomConfirmed === true;
  const mapping = bom ? pcRecord(input.bomMapping) as unknown as BomMapping : null;
  const base = bom && mapping ? scanBom(bom.sheets as unknown as BomSheet[], mapping) : [];
  const rows = confirmed ? confirmBomRows(base, input.bomRows) : base;
  const values = { revision: pcText(input.revision, "资料版本", 40), needFixture: need,
    parallelCount: pcInt(input.parallelCount ?? 1, "同时测试产品数量", 1, 1000), spareCount: pcInt(input.spareCount ?? 0, "每种对插件备用数量", 0, 10000),
    drawingFiles: qfJson(files.map(f => ({ id: f.id, name: f.displayName || f.originalName, version: f.version, sha256: f.sha256 || "", objectKey: f.objectKey, mimeType: f.mimeType }))),
    sopFiles: qfJson(sops.map(f => ({ id: f.id, name: f.displayName || f.originalName, version: f.version, sha256: f.sha256 || "", objectKey: f.objectKey, mimeType: f.mimeType }))),
    sourceSignature: await (await import("@/lib/quality-fixture-sync")).currentDocumentSignature(tx, libraryItemId),
    bomFileId, bomMapping: mapping ? qfJson(mapping) : Prisma.JsonNull, bomRows: qfJson(rows), bomConfirmed: !!confirmed, status: "DRAFT", reason: "" };
  const fingerprint = documentFingerprint({ ...values, bomMapping: mapping });
  // Compatibility for existing clients: preparation-only edits never replace signed documents.
  if (need && input.bomFileId) await saveFixturePreparation(tx, { ...input, libraryItemId }, a, true);
  if (old && old.status !== "DRAFT" && old.status !== "RETURNED" && old.status !== "REVOKED" &&
    old.revision === values.revision && JSON.stringify(canonical([old.drawingFiles, old.sopFiles])) === JSON.stringify(canonical([values.drawingFiles, values.sopFiles]))) return old;
  let p: QfPackage;
  if (old?.status === "DRAFT") p = await tx.qfPackage.update({ where: { id: old.id }, data: { ...values, fingerprint, version: { increment: 1 } } });
  else {
    const last = await tx.qfPackage.findFirst({ where: { libraryItemId }, orderBy: { sequence: "desc" } });
    p = await tx.qfPackage.create({ data: { ...values, fingerprint, libraryItemId, sequence: (last?.sequence || 0) + 1, createdById: a.id } });
  }
  await event(tx, a, "PACKAGE", p.id, "SAVE", { before: old, after: p });
  return p;
}
export async function submitPackage(tx: Tx, input: PcInput, a: PcActor, returnSubmission = false) {
  const p = await getPackage(tx, input.id, input.version);
  if (p.status !== "DRAFT") conflict("请先建立资料修订草稿，再提交双方审核");
  if (!returnSubmission && await tx.qfDocumentReturn.count({ where: { libraryItemId: p.libraryItemId, status: { not: "RESOLVED" } } }))
    conflict("存在未关闭的退回事项，请在图纸资料库完成技术处理并重新提交，不能直接送审");
  const issues = fixtureSubmissionIssues({ ...p, needFixture: p.libraryItem.fixtureRequired });
  if (issues.length) conflict(issues.join("；"));
  await assertPackageFiles(tx, p);
  const recipients = await pendingReviewers(tx, { ...p, status: "REVIEWING", submittedById: a.id });
  if (!["SUPERVISOR", "QUALITY"].every(role => recipients.some(r => r.roles.some(v => v === role))))
    conflict("请配置可审核本资料的主管、品质人员，或启用管理员账号");
  const result = await tx.qfPackage.update({ where: { id: p.id }, data: { status: "REVIEWING", version: { increment: 1 }, submittedById: a.id, submittedByName: actorName(a), submittedAt: new Date(),
    supervisorId: null, supervisorName: "", supervisorAt: null, supervisorAsAdmin: false, qualityId: null, qualityName: "", qualityAt: null, qualityAsAdmin: false } });
  await event(tx, a, "PACKAGE", p.id, "SUBMIT", result);
  await closeTodos(tx, p.id);
  await notifyPendingReviews(tx, a, result, p.libraryItem.specification);
  return { id: result.id, version: result.version };
}
async function review(tx: Tx, input: PcInput, a: PcActor) {
  const p = await getPackage(tx, input.id, input.version);
  if (!QF_REVIEW_STATUSES.includes(p.status)) conflict("该版本当前不在待审核状态");
  const s = await settings(tx), admin = a.laborRole === "ADMIN";
  const ids = [...p.drawingFiles as unknown as DrawingEvidence[], ...p.sopFiles as unknown as DrawingEvidence[]].map(f => f.id);
  const ownsDrawing = !admin && await tx.drawingLibraryFile.count({ where: { id: { in: ids }, uploadedById: a.id } });
  const roles = fixtureReviewRoles(p, a, s, !!ownsDrawing);
  const role = input.reviewRole || (roles.length === 1 ? roles[0] : null);
  if (!role && roles.length > 1) throw new FixtureError("请选择以主管或品质身份审核，每项分别记录");
  if (!roles.some(r => r === role)) denied("当前审核项已完成或你无权审核；普通上传人不能自审，主管与品质须由不同账号完成");
  const approve = input.action === "APPROVE";
  if (approve) {
    if (await tx.qfPackage.count({ where: { libraryItemId: p.libraryItemId, sequence: { gt: p.sequence }, supervisorAt: { not: null }, qualityAt: { not: null } } }))
      conflict("已有更新的资料版本完成双方审核，不能再批准这份旧稿。请退回旧稿，或基于所需资料新建修订版本。");
    if (input.confirmed !== true) throw new FixtureError("请确认已核对本版本图纸 / SOP");
  }
  const reason = pcText(input.reason, "退回意见", 2000, !approve);
  if (approve) await assertPackageFiles(tx, p);
  const returns = !approve ? await (await import("@/lib/quality-document-returns")).recordDocumentReturn(tx, p, input, a, String(role), reason) : [];
  const next = !approve ? "RETURNED" : (role === "SUPERVISOR" ? p.qualityAt : p.supervisorAt) ? "APPROVED" : role === "SUPERVISOR" ? "QUALITY" : "SUPERVISOR";
  if (next === "APPROVED") await tx.qfPackage.updateMany({ where: { libraryItemId: p.libraryItemId, status: "APPROVED", id: { not: p.id } }, data: { status: "SUPERSEDED", version: { increment: 1 } } });
  const result = await tx.qfPackage.update({ where: { id: p.id }, data: { status: next, reason, version: { increment: 1 },
    ...(approve ? role === "SUPERVISOR" ? { supervisorId: a.id, supervisorName: actorName(a), supervisorAt: new Date(), supervisorAsAdmin: admin } : { qualityId: a.id, qualityName: actorName(a), qualityAt: new Date(), qualityAsAdmin: admin } : {}) } });
  await event(tx, a, "PACKAGE", p.id, String(input.action), { before: p.status, after: result, reviewRole: role, asAdmin: admin, returns }, reason);
  if (next === "APPROVED") await (await import("@/lib/quality-document-returns")).closeReviewedReturns(tx, result, a);
  await closeTodos(tx, p.id);
  if (QF_REVIEW_STATUSES.includes(next)) await notifyPendingReviews(tx, a, result, p.libraryItem.specification);
  else if (next === "APPROVED") await notify(tx, a, result, [p.submittedById!], "生产资料双方审核完成 · " + p.libraryItem.specification);
  return { id: result.id, version: result.version, status: result.status };
}
async function saveMapping(tx: Tx, input: PcInput, a: PcActor) {
  const previous = input.mappingId ? await tx.qfMapping.findUnique({ where: { id: pcText(input.mappingId, "配对", 100) } }) : null;
  if (input.mappingId && !previous?.active) conflict("该配对已变更或删除，请刷新");
  if (previous) { pcVersion(previous.version, input.mappingVersion); await tx.qfMapping.update({ where: { id: previous.id }, data: { active: false, preferred: false, version: { increment: 1 } } }); }
  const model = pcText(input.connectorModel, "连接器型号", 200), manufacturer = "";
  const connector = await tx.qfConnector.upsert({ where: { model_manufacturer: { model, manufacturer } }, create: { model, manufacturer, name: pcText(input.connectorName, "连接器名称", 200, false) }, update: {} });
  const evidence = pcText(input.evidence, "对插规格确认依据", 1000, false) || "人工确认连接器与对插型号";
  let createdFixture = false;
  let fixture = input.fixtureId ? await tx.qfFixture.findUnique({ where: { id: pcText(input.fixtureId, "对插件", 100) } }) : null;
  if (input.fixtureId && !fixture?.active) throw new FixtureError("所选对插件不存在或已停用");
  if (!fixture) {
    const mateModel = pcText(input.model, "对插型号", 200), maker = "";
    fixture = await tx.qfFixture.findFirst({ where: { model: mateModel }, orderBy: { createdAt: "asc" } });
    if (!fixture) {
      const number = await qfSerial(tx, "TJ"), name = pcText(input.name || mateModel, "对插件名称", 200), unit = pcChoice(input.unit || "个", ["个", "套", "件"], "单位");
      const item = await tx.pcItem.create({ data: { number, name, spec: mateModel, unit, category: "导通治具" } });
      fixture = await tx.qfFixture.create({ data: { number, name, model: mateModel, manufacturer: maker, itemId: item.id, unit, assemblyRequired: input.assemblyRequired === true } });
      createdFixture = true;
    }
  }
  if (!fixture.active) conflict("该对插件已停用，请先核对状态");
  await tx.qfMapping.updateMany({ where: { connector: { model }, active: true, preferred: true }, data: { active: false, preferred: false, version: { increment: 1 } } });
  const mapping = await tx.qfMapping.create({ data: { connectorId: connector.id, fixtureId: fixture.id, evidence, scope: pcText(input.scope, "适用范围", 1000, false), confirmedById: a.id, confirmedByName: actorName(a) } });
  const quantity = pcInt(input.initialQuantity ?? 0, "初始数量", 0, 1000000);
  if (quantity && !createdFixture) conflict("已有对插型号共用现有库存，请通过数量调整补充，不要重复初始化");
  if (quantity) {
    const stock = await tx.pcStockBalance.create({ data: { itemId: fixture.itemId, warehouse: "治具库", location: "默认", onHand: quantity } });
    await tx.pcStockMovement.create({ data: { stockId: stock.id, kind: "FIXTURE_OPENING", quantity, balance: quantity, sourceId: mapping.id,
      reason: "人工登记现有治具数量", person: actorName(a), actorId: a.id, actorName: actorName(a) } });
  }
  await event(tx, a, "MAPPING", mapping.id, previous ? "EDIT_MAPPING" : "CONFIRM_SPECIFICATION", { previous, connector, fixture, mapping, initialQuantity: quantity });
  return { id: mapping.id, fixtureId: fixture.id };
}
export async function createFixturePurchase(tx: Tx, input: PcInput, a: PcActor) {
  const p = input.packageId ? await getPackage(tx, input.packageId) : null;
  const libraryItemId = input.libraryItemId ? pcText(input.libraryItemId, "产品", 100) : p?.libraryItemId;
  if (p && libraryItemId !== p.libraryItemId) conflict("治具申购产品与来源资料不一致");
  const product = libraryItemId ? await tx.drawingLibraryItem.findFirst({ where: { id: libraryItemId, deletedAt: null, fixtureRequired: true } }) : null;
  if (libraryItemId && !product) conflict("请确认有效产品已选择需要治具");
  const preparation = product ? await getFixturePreparation(tx, product.id) : null;
  if (preparation && input.preparationVersion !== undefined && preparation.version !== input.preparationVersion) conflict("BOM 需求已更新，请刷新后重新申购");
  const readiness = product ? await fixtureReadiness(tx, { libraryItemId: product.id }) : null;
  if (readiness && !readiness.calculated) conflict("请先确认 BOM 连接器清单，再按缺口申购；资料审核与打印不受影响");
  const group = readiness?.groups.find(g => g.fixtureId === input.fixtureId);
  if (product && !group) throw new FixtureError("该对插件不是当前已确认的治具需求");
  const quantity = pcInt(input.quantity, "申购数量", 1, 1000000), estimateCents = pcInt(input.estimateCents, "预算合计（分）", 1);
  if (group) {
    const incremental = Math.max(0, group.shortage - group.incoming);
    if (quantity > incremental) conflict("现有库存和未结束申购已覆盖部分需求，本次最多新增 " + incremental + " " + group.unit);
  }
  const pc = await tx.pcSettings.findUnique({ where: { id: "purchasing" } });
  if (!pc) conflict("请先配置采购流程负责人");
  const fixture = await tx.qfFixture.findFirst({ where: { id: pcText(input.fixtureId, "对插件", 100), active: true, mappings: { some: { active: true, preferred: true } } } });
  if (!fixture) throw new FixtureError("请先确认对插件与连接器的有效匹配关系");
  const reason = product ? "" : pcText(input.reason, "治具库补充申购用途", 1000);
  const request = await tx.pcRequest.create({ data: { source: "FIXTURE", number: await qfSerial(tx, "TJCG"), status: "PENDING",
    applicantId: a.id, applicantName: actorName(a), submitterId: a.id, submitterName: actorName(a),
    purpose: product ? "导通治具 · " + product.specification + " · 准备第 " + preparation!.version + " 版" : "治具库补充申购 · " + reason } });
  const line = await tx.pcLine.create({ data: { requestId: request.id, number: request.number + "-01", name: fixture.name, spec: fixture.model, unit: fixture.unit,
    category: "导通治具", needDate: pcDate(input.needDate, "需求日期"), urgency: pcChoice(input.urgency || "NORMAL", ["NORMAL", "URGENT", "CRITICAL"], "紧急程度"),
    quantity, estimateCents, status: "PENDING", itemId: fixture.itemId, fixtureId: fixture.id, fixturePackageId: p?.id,
    fixtureBasis: qfJson(product && group ? { libraryItemId: product.id, preparation, packageId: p?.id, mappings: group.mappingIds, connectors: group.connectorModels, required: group.required } :
      { mode: "LIBRARY_REPLENISHMENT", fixtureId: fixture.id, model: fixture.model, reason, quantity }) } });
  await tx.pcEvent.create({ data: { entityType: "LINE", entityId: line.id, action: "SUBMIT", actorId: a.id, actorName: actorName(a), snapshot: qfJson(line) } });
  await event(tx, a, product ? "PREPARATION" : "FIXTURE", product?.id || fixture.id, "CREATE_PURCHASE", { requestId: request.id, lineId: line.id, fixtureId: fixture.id, quantity });
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
      const supervisors = Array.isArray(input.supervisorIds) && input.supervisorIds.length === 0 ? [] : pcIds(input.supervisorIds, "主管"),
        qualities = Array.isArray(input.qualityIds) && input.qualityIds.length === 0 ? [] : pcIds(input.qualityIds, "品质人员");
      const technicals = input.technicalIds === undefined ? old?.technicalIds || [] : Array.isArray(input.technicalIds) && input.technicalIds.length === 0 ? [] : pcIds(input.technicalIds, "技术处理人员");
      const overlap = supervisors.filter(id => qualities.includes(id));
      if (await tx.user.count({ where: { id: { in: overlap }, laborRole: { not: "ADMIN" } } })) throw new FixtureError("普通主管和品质负责人不能重叠；管理员默认具备两项权限");
      await users(tx, [...new Set([...supervisors, ...qualities, ...technicals])]);
      if ((!supervisors.length || !qualities.length) && !await tx.user.count({ where: { laborRole: "ADMIN", isActive: true, accountStatus: "ACTIVE" } }))
        throw new FixtureError("请设置双方负责人或至少一个有效管理员");
      result = await tx.qfSettings.upsert({ where: { id: "quality-fixtures" }, create: { ownerId: a.id, supervisorIds: supervisors, qualityIds: qualities, technicalIds: technicals },
        update: { supervisorIds: supervisors, qualityIds: qualities, technicalIds: technicals, version: { increment: 1 } } });
      await event(tx, a, "SETTINGS", "quality-fixtures", action, { before: old, after: result });
    } else if (action === "SAVE_PACKAGE") result = await savePackage(tx, input, a);
    else if (action === "RESPOND_RETURN") result = await (await import("@/lib/quality-document-returns")).saveDocumentReturnResponse(tx, input, a);
    else if (action === "RESUBMIT_RETURNS") result = await (await import("@/lib/quality-document-returns")).resubmitDocumentReturns(tx, input, a);
    else if (action === "SAVE_PREPARATION") result = await saveFixturePreparation(tx, input, a);
    else if (action === "SET_REQUIREMENT") {
      if (typeof input.needFixture !== "boolean") throw new FixtureError("请选择需要或无需治具");
      if (input.expectedNeedFixture !== undefined && input.expectedNeedFixture !== null && typeof input.expectedNeedFixture !== 'boolean') throw new FixtureError('治具要求校验参数无效');
      result = await (await import("@/lib/quality-fixture-sync")).setFixtureRequirement(tx, pcIds(input.productIds, "产品"), input.needFixture, a, input.expectedNeedFixture as boolean | null | undefined);
    }
    else if (action === "SUBMIT") result = await submitPackage(tx, input, a);
    else if (action === "APPROVE" || action === "RETURN") result = await review(tx, input, a);
    else if (action === "SAVE_MAPPING") result = await saveMapping(tx, input, a);
    else if (action === "DELETE_MAPPING") {
      const mapping = await tx.qfMapping.findUnique({ where: { id: pcText(input.id, "配对", 100) } });
      if (!mapping?.active) conflict("该配对已删除，请刷新");
      pcVersion(mapping.version, input.version);
      result = await tx.qfMapping.update({ where: { id: mapping.id }, data: { active: false, preferred: false, version: { increment: 1 } } });
      await event(tx, a, "MAPPING", mapping.id, action, { before: mapping, after: result });
    } else if (action === "SET_QUANTITY") {
      const fixture = await tx.qfFixture.findUnique({ where: { id: pcText(input.fixtureId, "对插型号", 100) }, include: { item: { include: { balances: true } } } });
      if (!fixture?.active) conflict("对插型号不存在或已停用");
      const total = fixture.item.balances.reduce((n, b) => n + b.onHand, 0);
      if (Number(input.expectedOnHand) !== total) conflict("库存已变化，请刷新后调整");
      const quantity = pcInt(input.quantity, "在库数量", 0, 1000000), delta = quantity - total;
      if (-delta > fixture.item.balances.reduce((n, b) => n + fixtureAvailable(b), 0)) conflict("不能减少已预留、待验证或维修中的库存，请先核对占用");
      let remaining = Math.abs(delta);
      const balances = delta > 0 ? [await tx.pcStockBalance.create({ data: { itemId: fixture.itemId, warehouse: "治具库", location: "默认" } })] : fixture.item.balances;
      for (const b of balances) {
        const change = delta > 0 ? remaining : -Math.min(remaining, fixtureAvailable(b));
        if (!change) continue;
        const updated = await tx.pcStockBalance.update({ where: { id: b.id }, data: { onHand: { increment: change }, version: { increment: 1 } } });
        await tx.pcStockMovement.create({ data: { stockId: b.id, kind: "FIXTURE_ADJUST", quantity: change, balance: updated.onHand,
          sourceId: fixture.id, reason: "人工盘点调整", person: actorName(a), actorId: a.id, actorName: actorName(a) } });
        remaining -= Math.abs(change);
      }
      result = { fixtureId: fixture.id, before: total, after: quantity };
      await event(tx, a, "FIXTURE", fixture.id, action, result);
    }
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
