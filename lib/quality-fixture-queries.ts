import { fixtureSubmissionIssues, type FixtureDocumentPackage } from "@/lib/quality-fixture-documents";
import { prisma } from "@/lib/prisma";
import { fixtureReadiness, assertPackageFiles } from "@/lib/quality-fixture-service";
import { fixtureAvailable, fixtureReviewRoles, fixtureSignaturesValid, QF_REVIEW_STATUSES } from "@/lib/quality-fixture-domain";
import type { PcActor } from "@/lib/purchasing-service";
import type { Prisma } from "@prisma/client";
import { fixturePlanScope, requiresDocumentReview } from "@/lib/quality-fixture-scope";
import { drawingPlanWeekScope, planWeekStart } from "@/lib/drawing-plan-week";
import { getFixturePreparation } from "@/lib/quality-fixture-preparation";
type Plain<T> = T extends Date ? string : T extends Array<infer U> ? Plain<U>[] : T extends object ? { [K in keyof T]: Plain<T[K]> } : T;
const plain = <T>(v: T): Plain<T> => JSON.parse(JSON.stringify(v));

export async function loadFixtureReviewQueue(actor: PcActor) {
  const [settings, latest] = await Promise.all([
    prisma.qfSettings.findUnique({ where: { id: "quality-fixtures" } }),
    prisma.qfPackage.findMany({ where: { libraryItem: fixturePlanScope }, distinct: ["libraryItemId"], orderBy: [{ libraryItemId: "asc" }, { sequence: "desc" }] }),
  ]);
  const fileIds = latest.flatMap(p => [...p.drawingFiles as unknown as {id:string}[], ...p.sopFiles as unknown as {id:string}[]].map(f => f.id));
  const files = actor.laborRole === "ADMIN" ? [] : await prisma.drawingLibraryFile.findMany({ where: { id: { in: fileIds }, uploadedById: actor.id }, select: { id: true } });
  const owned = new Set(files.map(f => f.id));
  const roles = new Map(latest.map(p => [p.id, fixtureReviewRoles(p, actor, settings,
    [...p.drawingFiles as unknown as {id:string}[], ...p.sopFiles as unknown as {id:string}[]].some(f => owned.has(f.id)))]));
  return { settings, latest, roles };
}

export function matchesFixtureReviewStatus(p: FixtureDocumentPackage & {status:string; supervisorAt: unknown; qualityAt: unknown}, status: string) {
  if (status === "SUPERVISOR") return QF_REVIEW_STATUSES.includes(p.status) && !p.supervisorAt;
  if (status === "QUALITY") return QF_REVIEW_STATUSES.includes(p.status) && !p.qualityAt;
  return status === "PENDING" ? p.status !== "APPROVED" : status === "MISSING" ? p.status === "RETURNED" || p.status === "DRAFT" && fixtureSubmissionIssues(p).length > 0 : p.status === status;
}

export async function loadQualityFixtures(query: URLSearchParams, actor: PcActor) {
  const search = (query.get("q") || "").trim().slice(0, 120), page = Math.max(1, Math.floor(Number(query.get("page")) || 1));
  const view = query.get("view") || "review", status = query.get("status") || "";
  const weekText = query.get("week") || "";
  const weekScope = weekText ? drawingPlanWeekScope(planWeekStart(weekText), true) : {};
  const searchScope: Prisma.DrawingLibraryItemWhereInput = search ? {OR:[{specification:{contains:search,mode:"insensitive"}},{customerName:{contains:search,mode:"insensitive"}},{libraryKey:{contains:search,mode:"insensitive"}}]} : {};
  const { latest, roles: queueRoles } = await loadFixtureReviewQueue(actor);
  const preparationAll = view === "plans" ? await prisma.drawingLibraryItem.findMany({where:{AND:[fixturePlanScope,weekScope,searchScope],fixtureRequired:true},include:{fixturePackages:{orderBy:{sequence:"desc"},take:1}}}) : [];
  const preparationStates = await Promise.all(preparationAll.map(async p => {
    const readiness=await fixtureReadiness(prisma,{ libraryItemId: p.id });
    const state=!readiness.calculated ? "BOM" : readiness.unmatched ? "MATCH" : readiness.missing ? readiness.groups.some(g=>g.incoming>0) ? "INCOMING" : "SHORT" : "READY";
    return {id:p.id,specification:p.specification,customerName:p.customerName,status:p.fixturePackages[0]?.status || "UNSET",bomConfirmed:readiness.calculated,state,readiness};
  }));
  const preparationStatus=query.get("prepStatus") || "";
  const where: Prisma.DrawingLibraryItemWhereInput = { AND: [fixturePlanScope,weekScope,searchScope, ...(query.get("mine") === "1" ? [{id:{in:latest.filter(p=>{ const roles=queueRoles.get(p.id) || []; return status === "SUPERVISOR" || status === "QUALITY" ? roles.includes(status) : roles.length > 0; }).map(p=>p.libraryItemId)}}] : []), ...(view === "plans" && preparationStatus ? [{id:{in:preparationStates.filter(p=>p.state===preparationStatus).map(p=>p.id)}}] : [])],
    ...(view === "plans" ? { fixtureRequired: true } : {}),
    ...(status ? { id: { in: latest.filter(p => matchesFixtureReviewStatus(p, status)).map(p => p.libraryItemId) } } : {}),
    ...(search ? { OR: [{ specification: { contains: search, mode: "insensitive" } }, { customerName: { contains: search, mode: "insensitive" } }, { libraryKey: { contains: search, mode: "insensitive" } }] } : {}) };
  const [settings, users, templates, products, total, statusCounts, fixtures, fixtureTotal, eventRows] = await Promise.all([
    prisma.qfSettings.findUnique({ where: { id: "quality-fixtures" } }),
    prisma.user.findMany({ where: { isActive: true, accountStatus: "ACTIVE" }, select: { id: true, username: true, displayName: true, laborRole: true }, orderBy: { displayName: "asc" } }),
    prisma.qfBomTemplate.findMany({ orderBy: { name: "asc" } }),
    prisma.drawingLibraryItem.findMany({ where, include: { fixturePackages: { orderBy: { sequence: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" }, skip: (page - 1) * 30, take: 30 }),
    prisma.drawingLibraryItem.count({ where }),
    Promise.resolve(Object.entries(latest.reduce((a, p) => { a[p.status] = (a[p.status] || 0) + 1; return a; }, {} as Record<string, number>)).map(([status, _count]) => ({ status, _count }))),
    prisma.qfFixture.findMany({ where: search && ["fixtures", "stock"].includes(query.get("view") || "") ? { OR: [{ model: { contains: search, mode: "insensitive" } }, { name: { contains: search, mode: "insensitive" } }, { mappings: { some: { connector: { model: { contains: search, mode: "insensitive" } } } } }] } : {},
      include: { mappings: { where: { active: true, preferred: true }, include: { connector: true } }, item: { include: { balances: { include: { holdings: true, movements: { orderBy: { createdAt: "desc" }, take: 15 } } } } } }, orderBy: { number: "desc" }, take: 500 }),
    prisma.qfFixture.count(),
    prisma.qfEvent.findMany({ orderBy: { createdAt: "desc" }, take: 25 }),
  ]);
  const preparationRows = products.flatMap(p=>{const row=preparationStates.find(r=>r.id===p.id);return row ? [row] : [];});
  const preparationCounts = preparationStates.reduce((result,p)=>{result[p.state]=(result[p.state] || 0)+1;return result;},{} as Record<string,number>);
  const requestedProduct = query.get("product");
  const requestedExists = requestedProduct ? await prisma.drawingLibraryItem.findFirst({ where: { AND: [where, { id: requestedProduct }] }, select: { id: true } }) : null;
  const productId = requestedExists?.id || products[0]?.id;
  const product = productId ? await prisma.drawingLibraryItem.findFirst({ where: { AND: [where, { id: productId }] },
    include: { files: { where: { deletedAt: null, isCurrent: true, category: { code: { in: ["drawing", "sop"] } } }, include: { category: { select: { code: true } } }, orderBy: { createdAt: "desc" } },
      productionPlanOrders: { where: { deletedAt: null }, select: { sourceOrderNo: true, batches: { where: { deletedAt: null, documentReviewRequired: true }, select: { id: true, weekStartDate: true, quantity: true } } } },
      fixturePackages: { orderBy: { sequence: "desc" } }, fixtureBomFiles: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, createdAt: true, byteSize: true, sha256: true } } } }) : null;
  const chosen = product?.fixturePackages.find(p => p.id === query.get("package")) || product?.fixturePackages[0] || null;
  const approved = product?.fixturePackages.find(p => p.status === "APPROVED") || null;
  const newerReviewed = chosen ? product?.fixturePackages.find(p => p.sequence > chosen.sequence && p.supervisorAt !== null && p.qualityAt !== null)?.revision || null : null;
  const preparation = product ? await getFixturePreparation(prisma, product.id) : null;
  const [readiness, packageEvents, workOrders, bom, preparationEvents] = await Promise.all([
    fixtureReadiness(prisma, product ? { libraryItemId: product.id } : null),
    chosen ? prisma.qfEvent.findMany({ where: { entityType: "PACKAGE", entityId: chosen.id }, orderBy: { createdAt: "desc" } }) : [],
    product ? prisma.workOrder.findMany({ where: { drawingLibraryItemId: product.id, deletedAt: null }, select: { id: true, code: true, status: true, fixtureBinding: true }, orderBy: { createdAt: "desc" }, take: 100 }) : [],
    preparation?.bomFileId ? prisma.qfBomFile.findFirst({ where: { id: preparation.bomFileId, deletedAt: null }, select: { id: true, name: true, sheets: true } }) : null,
    product ? prisma.qfEvent.findMany({ where: { entityId: product.id, entityType: { in: ["PREPARATION", "PRODUCT"] } }, orderBy: { createdAt: "desc" }, take: 100 }) : [],
  ]);
  const ownsEvidence = chosen ? await prisma.drawingLibraryFile.count({where:{id:{in:[...(chosen.drawingFiles as unknown as {id:string}[]),...(chosen.sopFiles as unknown as {id:string}[])].map(f=>f.id)},uploadedById:actor.id}}) > 0 : false;
  return plain({ actorId: actor.id, settings, users, templates, products, total, page, pageSize: 30, statusCounts,
    preparationRows, preparationCounts, fixtures: fixtures.map(f => ({ ...f, available: f.item.balances.reduce((n, b) => n + fixtureAvailable(b), 0),
      onHand: f.item.balances.reduce((n, b) => n + b.onHand, 0), held: f.item.balances.reduce((n, b) => n + b.held, 0),
      reserved: f.item.balances.reduce((n, b) => n + b.reserved, 0), issued: f.item.balances.reduce((n, b) => n + b.issued, 0) })),
    fixtureTotal, eventRows, product, chosen, approved, newerReviewed, readiness, packageEvents, workOrders, bom, preparation, preparationEvents,
    canConfigure: !settings || settings.ownerId === actor.id || actor.laborRole === "ADMIN",
    canReview: fixtureReviewRoles(chosen, actor, settings, ownsEvidence).length > 0,
    reviewRoles: fixtureReviewRoles(chosen, actor, settings, ownsEvidence),
    isAdmin: actor.laborRole === "ADMIN",
    canQuality: actor.laborRole === "ADMIN" || settings?.qualityIds.includes(actor.id) || false });
}
export type QfWorkbench = Awaited<ReturnType<typeof loadQualityFixtures>>;

export async function qualityFixtureBadges(ids: string[], kind: string) {
  const batches = kind === "batches" ? await prisma.productionPlanBatch.findMany({ where: { id: { in: ids }, deletedAt: null }, include: { planOrder: { select: { drawingLibraryItemId: true } }, workOrder: { select: { fixtureBinding: true } } } }) : [];
  const workOrders = kind === "orders" ? await prisma.workOrder.findMany({ where: { id: { in: ids }, deletedAt: null },
    select: { id: true, drawingLibraryItemId: true, fixtureBinding: true, documentReviewRequired: true, weekStartDate: true } }) : [];
  const productIds = kind === "orders" ? [...new Set(workOrders.flatMap(w => w.drawingLibraryItemId ? [w.drawingLibraryItemId] : []))] : kind === "batches" ? batches.flatMap(b => b.planOrder.drawingLibraryItemId ? [b.planOrder.drawingLibraryItemId] : []) : ids;
  const products = await prisma.drawingLibraryItem.findMany({ where: { id: { in: productIds }, deletedAt: null }, select: { id: true, fixtureRequired: true } });
  const packages = await prisma.qfPackage.findMany({ where: { libraryItemId: { in: productIds }, libraryItem: { deletedAt: null } }, orderBy: { sequence: "desc" } });
  return await Promise.all(ids.map(async id => {
    const order = workOrders.find(w => w.id === id), batch = batches.find(b => b.id === id);
    const productId = kind === "orders" ? order?.drawingLibraryItemId : kind === "batches" ? batch?.planOrder.drawingLibraryItemId : id;
    const legacy = kind === "orders" ? !!order && !requiresDocumentReview(order) : kind === "batches" ? !!batch && !requiresDocumentReview(batch) : false;
    const available = packages.filter(p => p.libraryItemId === productId);
    const binding = order?.fixtureBinding || batch?.workOrder?.fixtureBinding;
    const p = binding ? packages.find(p => p.id === binding.packageId) : available[0];
    let printAllowed = !!p && fixtureSignaturesValid(p) && (p.status === "APPROVED" || (p.status === "SUPERSEDED" && p.continuedWorkOrderIds.includes(batch?.workOrderId || id)));
    if (printAllowed && p) { try {
      await assertPackageFiles(prisma, p);
      if (!binding && p.sourceSignature && !await (await import("@/lib/quality-fixture-sync")).packageMatchesCurrentDocuments(prisma,p)) printAllowed = false;
    } catch { printAllowed = false; } }
    const readiness = await fixtureReadiness(prisma, productId ? { libraryItemId: productId } : null, kind === "orders" ? id : "");
    return { id, productId, packageId: p?.id, revision: p?.revision, legacy, status: legacy ? "LEGACY" : p?.status === "APPROVED" && !printAllowed ? "DRAFT" : p?.status || "UNSET", needFixture: products.find(p => p.id === productId)?.fixtureRequired ?? null,
      pendingRevision: available[0]?.id !== p?.id ? available[0]?.revision : null, printAllowed: legacy || printAllowed,
      submissionIssues: p ? fixtureSubmissionIssues(p) : ["请准备生产资料"], fixtureLabel: legacy ? "" : readiness.label, supervisor: p?.supervisorName, quality: p?.qualityName, supervisorAt:p?.supervisorAt?.toISOString(), qualityAt:p?.qualityAt?.toISOString(), groups:readiness.groups.map(g=>({model:g.model,required:g.required,available:g.available,incoming:g.incoming,shortage:g.shortage})), sopFiles: p?.sopFiles || [], drawingFiles: p?.drawingFiles || [] };
  }));
}
