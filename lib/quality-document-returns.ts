import { Prisma, type QfPackage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { pcChoice, pcIds, pcRecord, pcText, pcVersion, type PcInput } from "@/lib/purchasing-domain";
import type { PcActor } from "@/lib/purchasing-service";
import { FixtureError, type DrawingEvidence } from "@/lib/quality-fixture-domain";
import { qfJson, savePackage, submitPackage } from "@/lib/quality-fixture-service";
import { currentDocumentSource } from "@/lib/quality-fixture-sync";
import { createSystemNotification } from "@/lib/system-notifications";

type Tx = Prisma.TransactionClient;
const name = (a: PcActor) => a.displayName || a.username;
function conflict(message: string): never { throw new FixtureError(message, "FIXTURE_CONFLICT", 409); }
export const activeReturnWhere = { status: { not: "RESOLVED" } } as const;

export async function reviewAttachmentIds(tx: Tx, libraryItemId: string, value: unknown) {
  const ids = Array.isArray(value) && value.length ? pcIds(value, "说明附件") : [];
  if (ids.length > 6) throw new FixtureError("每次最多附 6 份说明附件");
  if (ids.length && await tx.qfReviewAttachment.count({ where: { id: { in: ids }, libraryItemId } }) !== ids.length)
    throw new FixtureError("说明附件不存在或不属于此产品");
  return ids;
}

export async function recordDocumentReturn(tx: Tx, p: QfPackage, input: PcInput, actor: PcActor, role: string, reason: string) {
  const fileIds = pcIds(input.fileIds, "退回文件"), location = pcText(input.location, "问题页码 / 位置", 200, false);
  const files = [
    ...(p.drawingFiles as unknown as DrawingEvidence[]).map(f => ({ ...f, kind: "drawing" })),
    ...(p.sopFiles as unknown as DrawingEvidence[]).map(f => ({ ...f, kind: "sop" })),
  ];
  if (fileIds.some(id => !files.some(f => f.id === id))) throw new FixtureError("只能退回本轮实际受审的图纸或 SOP");
  const attachmentIds = await reviewAttachmentIds(tx, p.libraryItemId, input.attachmentIds);
  // A rejected review round cannot resolve previous issues; retain their existing replies.
  await tx.qfDocumentReturn.updateMany({ where: { submittedPackageId: p.id, status: "REVIEWING" },
    data: { status: "READY", version: { increment: 1 } } });
  const created = [];
  for (const id of fileIds) {
    const file = files.find(f => f.id === id)!;
    created.push(await tx.qfDocumentReturn.create({ data: {
      libraryItemId: p.libraryItemId, sourcePackageId: p.id, fileId: file.id, fileSnapshot: qfJson(file), kind: file.kind,
      reason, location, attachmentIds, reviewRole: role, returnedById: actor.id, returnedByName: name(actor),
    } }));
  }
  const [settings, uploads] = await Promise.all([
    tx.qfSettings.findUnique({ where: { id: "quality-fixtures" } }),
    tx.drawingLibraryFile.findMany({ where: { id: { in: fileIds } }, select: { uploadedById: true } }),
  ]);
  const recipients = [...new Set([p.submittedById, ...uploads.map(f => f.uploadedById), ...(settings?.technicalIds || [])].filter((v): v is string => !!v))];
  const active = await tx.user.findMany({ where: { id: { in: recipients }, isActive: true, accountStatus: "ACTIVE" }, select: { id: true } });
  await createSystemNotification(tx, {
    eventType: "QUALITY_DOCUMENT_RETURN", dedupeKey: "qf:return:" + p.id + ":" + p.version, category: "TODO",
    title: "生产资料审核不通过 · " + [...new Set(created.map(c => c.kind === "sop" ? "SOP" : "图纸"))].join("、"),
    sourceType: "QUALITY_DOCUMENT_RETURN", sourceId: p.libraryItemId, actorId: actor.id,
    targetRoute: "/drawing-library?itemId=" + p.libraryItemId + "&returns=1", recipientUserIds: active.map(u => u.id),
  });
  return created.map(c => ({ id: c.id, fileId: c.fileId, kind: c.kind, reason: c.reason, location: c.location }));
}

async function recordResponseEvent(tx: Tx, actor: PcActor, libraryItemId: string, action: string, snapshot: unknown, reason = "") {
  await tx.qfEvent.create({ data: { entityType: "DOCUMENT_RETURN", entityId: libraryItemId, action,
    actorId: actor.id, actorName: name(actor), snapshot: qfJson(snapshot), reason } });
}

export async function saveDocumentReturnResponse(tx: Tx, input: PcInput, actor: PcActor) {
  const issue = await tx.qfDocumentReturn.findUnique({ where: { id: pcText(input.id, "退回事项", 100) }, include: { libraryItem: { select: { deletedAt: true } } } });
  if (!issue || issue.libraryItem.deletedAt) throw new FixtureError("退回事项不存在或产品已归档");
  pcVersion(issue.version, input.version);
  if (!["OPEN", "READY"].includes(issue.status)) conflict("该事项已提交复核或已关闭，请刷新");
  const mode = pcChoice(input.mode, ["REPLACE", "EXPLAIN"] as const, "处理方式");
  const reason = pcText(input.reason, mode === "REPLACE" ? "修改说明" : "技术解释", 2000);
  const attachmentIds = await reviewAttachmentIds(tx, issue.libraryItemId, input.attachmentIds);
  const fileId = mode === "EXPLAIN" ? issue.fileId : pcText(input.fileId, "更换后的文件", 100);
  if (fileId) {
    const file = await tx.drawingLibraryFile.findFirst({ where: { id: fileId, libraryItemId: issue.libraryItemId, deletedAt: null, isCurrent: true }, include: { category: true } });
    if (!file) conflict("处理文件已被替换或移除，请选择当前版本后再回复");
    if (issue.kind !== "package" && file.category.code !== issue.kind) throw new FixtureError("图纸和 SOP 必须对应原退回分类");
    if (mode === "REPLACE") {
      if (file.id === issue.fileId) throw new FixtureError("更换文件请选择新版本；保留原文件请使用说明原因");
      if (issue.fileId) {
        const lineage = await fileDescendsFrom(tx, file.id, issue.fileId);
        if (!lineage) throw new FixtureError("请使用替换上传，或选择确实承接此退回文件的新版");
      }
    }
  } else if (issue.kind !== "package") throw new FixtureError("退回文件未关联，请刷新");
  const result = await tx.qfDocumentReturn.update({ where: { id: issue.id }, data: {
    status: "READY", responseMode: mode, responseText: reason, responseFileId: fileId,
    responseAttachmentIds: attachmentIds, respondedById: actor.id, respondedByName: name(actor), respondedAt: new Date(), version: { increment: 1 },
  } });
  await recordResponseEvent(tx, actor, issue.libraryItemId, "TECHNICAL_RESPONSE", { before: issue, after: result }, reason);
  return result;
}

export async function fileDescendsFrom(tx: Pick<Tx, "drawingLibraryFile">, candidateId: string, ancestorId: string) {
  const seen = new Set<string>();
  let next: string | null = candidateId;
  while (next && !seen.has(next)) {
    if (next === ancestorId) return true;
    seen.add(next);
    const row: { supersedesFileId: string | null } | null = await tx.drawingLibraryFile.findUnique({ where: { id: next }, select: { supersedesFileId: true } });
    next = row?.supersedesFileId || null;
  }
  return false;
}

export async function resubmitDocumentReturns(tx: Tx, input: PcInput, actor: PcActor, options: { activeOrdersOnly?: boolean } = {}) {
  const libraryItemId = pcText(input.libraryItemId, "产品", 100);
  const issues = await tx.qfDocumentReturn.findMany({ where: { libraryItemId, ...activeReturnWhere }, orderBy: { createdAt: "asc" } });
  if (!issues.length) conflict("没有待重新提交的退回事项");
  const versions = pcRecord(input.versions);
  if (Object.keys(versions).length !== issues.length) conflict("退回事项已变化，请刷新后重新提交");
  for (const issue of issues) {
    pcVersion(issue.version, versions[issue.id]);
    if (issue.status !== "READY" || !issue.responseText.trim()) conflict("请先逐项更换文件或填写技术解释，全部处理后再提交");
  }
  const source = await currentDocumentSource(tx, libraryItemId);
  const evidence = [...source.drawingFiles, ...source.sopFiles];
  for (const issue of issues) {
    if (issue.responseFileId && !evidence.some(f => f.id === issue.responseFileId)) conflict("技术回复引用的文件已变化，请重新核对并保存回复");
  }
  const last = await tx.qfPackage.findFirst({ where: { libraryItemId }, orderBy: { sequence: "desc" } });
  if (last && ["REVIEWING", "SUPERVISOR", "QUALITY"].includes(last.status)) conflict("已有待复核资料，请完成当前审核");
  const p = await savePackage(tx, { action: "SAVE_PACKAGE", libraryItemId, id: last?.id, version: last?.version,
    revision: last?.revision || "V1.0", needFixture: source.needFixture,
    drawingFileIds: source.drawingFiles.map(f => f.id), sopFileIds: source.sopFiles.map(f => f.id) }, actor);
  // This internal flag is never accepted from an HTTP request.
  const submitted = await submitPackage(tx, { id: p.id, version: p.version }, actor, true);
  await tx.qfDocumentReturn.updateMany({ where: { id: { in: issues.map(i => i.id) } }, data: {
    status: "REVIEWING", submittedPackageId: submitted.id, version: { increment: 1 },
  } });
  const priorIds = [...new Set(issues.flatMap(i => [i.sourcePackageId, i.submittedPackageId].filter((id): id is string => !!id)))];
  const returnedFileIds = new Set(issues.map(i => i.fileId).filter((id): id is string => !!id));
  const candidates = await tx.qfPlanBinding.findMany({ where: { workOrder: { drawingLibraryItemId: libraryItemId, deletedAt: null,
    ...(options.activeOrdersOnly ? { completedAt: null, status: { notIn: ['completed', 'cancelled', 'archived'] } } : {}) } },
    include: { package: { select: { drawingFiles: true, sopFiles: true } } } });
  // An older binding to the same rejected file needs the corrected round too.
  // Unrelated historical versions remain attached to their original approval.
  const bindings = candidates.filter(b => priorIds.includes(b.packageId) ||
    [...b.package.drawingFiles as unknown as DrawingEvidence[], ...b.package.sopFiles as unknown as DrawingEvidence[]]
      .some(f => returnedFileIds.has(f.id)));
  await tx.qfPlanBinding.updateMany({ where: { workOrderId: { in: bindings.map(b => b.workOrderId) } },
    data: { packageId: submitted.id, selectedById: actor.id, selectedAt: new Date() } });
  await recordResponseEvent(tx, actor, libraryItemId, "RESUBMIT_RETURNS", { issues, packageId: submitted.id, workOrderIds: bindings.map(b => b.workOrderId), files: evidence });
  await tx.systemNotificationRecipient.updateMany({ where: { notification: { sourceType: "QUALITY_DOCUMENT_RETURN", sourceId: libraryItemId }, completedAt: null },
    data: { completedAt: new Date(), completionKind: "SOURCE_RESOLVED", completionReason: "技术已回复并重新提交双方审核" } });
  return submitted;
}

export async function closeReviewedReturns(tx: Tx, p: QfPackage, actor: PcActor) {
  const issues = await tx.qfDocumentReturn.findMany({ where: { submittedPackageId: p.id, status: "REVIEWING" } });
  if (!issues.length) return;
  await tx.qfDocumentReturn.updateMany({ where: { id: { in: issues.map(i => i.id) } }, data: { status: "RESOLVED", resolvedAt: new Date(), version: { increment: 1 } } });
  await recordResponseEvent(tx, actor, p.libraryItemId, "RETURNS_RESOLVED", { packageId: p.id, issueIds: issues.map(i => i.id) });
}

export async function loadDocumentReturns(libraryItemId: string) {
  const [issues, attachments, events, orders, files] = await Promise.all([
    prisma.qfDocumentReturn.findMany({ where: { libraryItemId, libraryItem: { deletedAt: null } }, orderBy: { createdAt: "desc" },
      include: { sourcePackage: { select: { revision: true, sequence: true } }, submittedPackage: { select: { status: true, revision: true, sequence: true } },
        responseFile: { select: { id: true, originalName: true, displayName: true, version: true } } } }),
    prisma.qfReviewAttachment.findMany({ where: { libraryItemId }, select: { id: true, name: true, createdAt: true, mimeType: true } }),
    prisma.qfEvent.findMany({ where: { entityType: "DOCUMENT_RETURN", entityId: libraryItemId }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.workOrder.findMany({ where: { drawingLibraryItemId: libraryItemId, deletedAt: null }, select: { id: true, code: true, status: true, qrTicket: { select: { prints: { select: { id: true } } } } }, take: 100 }),
    prisma.drawingLibraryFile.findMany({ where: { libraryItemId, deletedAt: null, category: { code: { in: ["drawing", "sop"] } } },
      select: { id: true, originalName: true, displayName: true, version: true, categoryId: true, category: { select: { code: true } }, supersedesFileId: true, isCurrent: true } }),
  ]);
  return JSON.parse(JSON.stringify({ issues, attachments, events, files,
    orders: orders.map(o => ({ id: o.id, code: o.code, status: o.status, printCount: o.qrTicket?.prints.length || 0 })) })) as ReturnData;
}

// DTO is kept independent of the Prisma runtime for client components.
export type ReturnData = {
  issues: Array<{ id: string; fileId: string | null; fileSnapshot: DrawingEvidence; kind: string; reason: string; location: string; attachmentIds: string[];
    reviewRole: string; returnedByName: string; status: string; version: number; createdAt: string; respondedAt: string | null; resolvedAt: string | null;
    responseMode: string | null; responseText: string; responseFileId: string | null; responseAttachmentIds: string[]; respondedByName: string;
    sourcePackage: { revision: string; sequence: number }; submittedPackage: { status: string; revision: string; sequence: number } | null;
    responseFile: { id: string; originalName: string; displayName: string | null; version: string } | null }>;
  attachments: Array<{ id: string; name: string; createdAt: string; mimeType: string }>;
  events: Array<{ id: string; action: string; actorName: string; reason: string; createdAt: string; snapshot: unknown }>;
  orders: Array<{ id: string; code: string; status: string; printCount: number }>;
  files: Array<{ id: string; originalName: string; displayName: string | null; version: string; categoryId: string; category: { code: string }; supersedesFileId: string | null; isCurrent: boolean }>;
};
