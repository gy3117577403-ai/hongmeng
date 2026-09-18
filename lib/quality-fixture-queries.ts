import { prisma } from "@/lib/prisma";
import { fixtureReadiness, assertPackageFiles } from "@/lib/quality-fixture-service";
import { fixtureAvailable } from "@/lib/quality-fixture-domain";
import type { PcActor } from "@/lib/purchasing-service";
import type { Prisma } from "@prisma/client";
type Plain<T> = T extends Date ? string : T extends Array<infer U> ? Plain<U>[] : T extends object ? { [K in keyof T]: Plain<T[K]> } : T;
const plain = <T>(v: T): Plain<T> => JSON.parse(JSON.stringify(v));

export async function loadQualityFixtures(query: URLSearchParams, actor: PcActor) {
  const search = (query.get("q") || "").trim().slice(0, 120), page = Math.max(1, Math.floor(Number(query.get("page")) || 1));
  const review = query.get("view") === "review";
  const where: Prisma.DrawingLibraryItemWhereInput = { deletedAt: null,
    ...(review ? { fixturePackages: { some: { status: { in: ["SUPERVISOR", "QUALITY", "RETURNED"] } } } } : {}),
    ...(search ? { OR: [{ specification: { contains: search, mode: "insensitive" } }, { customerName: { contains: search, mode: "insensitive" } }, { libraryKey: { contains: search, mode: "insensitive" } }] } : {}) };
  const [settings, users, templates, products, total, statusCounts, fixtures, fixtureTotal, eventRows] = await Promise.all([
    prisma.qfSettings.findUnique({ where: { id: "quality-fixtures" } }),
    prisma.user.findMany({ where: { isActive: true, accountStatus: "ACTIVE" }, select: { id: true, username: true, displayName: true }, orderBy: { displayName: "asc" } }),
    prisma.qfBomTemplate.findMany({ orderBy: { name: "asc" } }),
    prisma.drawingLibraryItem.findMany({ where, include: { fixturePackages: { orderBy: { sequence: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" }, skip: (page - 1) * 30, take: 30 }),
    prisma.drawingLibraryItem.count({ where }),
    prisma.qfPackage.groupBy({ by: ["status"], _count: true }),
    prisma.qfFixture.findMany({ where: search && ["fixtures", "stock"].includes(query.get("view") || "") ? { OR: [{ model: { contains: search, mode: "insensitive" } }, { name: { contains: search, mode: "insensitive" } }, { mappings: { some: { connector: { model: { contains: search, mode: "insensitive" } } } } }] } : {},
      include: { mappings: { where: { active: true }, include: { connector: true } }, item: { include: { balances: { include: { holdings: true, movements: { orderBy: { createdAt: "desc" }, take: 15 } } } } } }, orderBy: { number: "desc" }, take: 500 }),
    prisma.qfFixture.count(),
    prisma.qfEvent.findMany({ orderBy: { createdAt: "desc" }, take: 25 }),
  ]);
  const productId = query.get("product") || products[0]?.id;
  const product = productId ? await prisma.drawingLibraryItem.findFirst({ where: { id: productId, deletedAt: null },
    include: { files: { where: { deletedAt: null, category: { code: "drawing" } }, orderBy: { createdAt: "desc" } },
      fixturePackages: { orderBy: { sequence: "desc" } }, fixtureBomFiles: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, createdAt: true, byteSize: true, sha256: true } } } }) : null;
  const chosen = product?.fixturePackages.find(p => p.id === query.get("package")) || product?.fixturePackages[0] || null;
  const approved = product?.fixturePackages.find(p => p.status === "APPROVED") || null;
  const newerReviewed = chosen ? product?.fixturePackages.find(p => p.sequence > chosen.sequence && p.qualityAt !== null)?.revision || null : null;
  const [readiness, packageEvents, workOrders, bom] = await Promise.all([
    fixtureReadiness(prisma, chosen),
    chosen ? prisma.qfEvent.findMany({ where: { entityType: "PACKAGE", entityId: chosen.id }, orderBy: { createdAt: "desc" } }) : [],
    product ? prisma.workOrder.findMany({ where: { drawingLibraryItemId: product.id, deletedAt: null }, select: { id: true, code: true, status: true, fixtureBinding: true }, orderBy: { createdAt: "desc" }, take: 100 }) : [],
    chosen?.bomFileId ? prisma.qfBomFile.findFirst({ where: { id: chosen.bomFileId, deletedAt: null }, select: { id: true, name: true, sheets: true } }) : null,
  ]);
  return plain({ actorId: actor.id, settings, users, templates, products, total, page, pageSize: 30, statusCounts,
    fixtures: fixtures.map(f => ({ ...f, available: f.item.balances.reduce((n, b) => n + fixtureAvailable(b), 0),
      onHand: f.item.balances.reduce((n, b) => n + b.onHand, 0), held: f.item.balances.reduce((n, b) => n + b.held, 0),
      reserved: f.item.balances.reduce((n, b) => n + b.reserved, 0), issued: f.item.balances.reduce((n, b) => n + b.issued, 0) })),
    fixtureTotal, eventRows, product, chosen, approved, newerReviewed, readiness, packageEvents, workOrders, bom,
    canConfigure: !settings || settings.ownerId === actor.id || actor.laborRole === "ADMIN",
    canReview: !!chosen && chosen.submittedById !== actor.id && (chosen.status === "SUPERVISOR" ? settings?.supervisorIds.includes(actor.id) :
      chosen.status === "QUALITY" && chosen.supervisorId !== actor.id ? settings?.qualityIds.includes(actor.id) : false),
    canQuality: settings?.qualityIds.includes(actor.id) || false });
}
export type QfWorkbench = Awaited<ReturnType<typeof loadQualityFixtures>>;

export async function qualityFixtureBadges(ids: string[], kind: string) {
  const workOrders = kind === "orders" ? await prisma.workOrder.findMany({ where: { id: { in: ids }, deletedAt: null },
    select: { id: true, drawingLibraryItemId: true, fixtureBinding: true } }) : [];
  const productIds = kind === "orders" ? [...new Set(workOrders.flatMap(w => w.drawingLibraryItemId ? [w.drawingLibraryItemId] : []))] : ids;
  const packages = await prisma.qfPackage.findMany({ where: { libraryItemId: { in: productIds }, libraryItem: { deletedAt: null } }, orderBy: { sequence: "desc" } });
  return await Promise.all(ids.map(async id => {
    const order = workOrders.find(w => w.id === id), productId = kind === "orders" ? order?.drawingLibraryItemId : id;
    const available = packages.filter(p => p.libraryItemId === productId);
    const p = order?.fixtureBinding ? packages.find(p => p.id === order.fixtureBinding?.packageId) : available.find(p => p.status === "APPROVED") || available[0];
    let printAllowed = !!p && (p.status === "APPROVED" || (p.status === "SUPERSEDED" && p.continuedWorkOrderIds.includes(id)));
    if (printAllowed && p) { try { await assertPackageFiles(prisma, p); } catch { printAllowed = false; } }
    const readiness = await fixtureReadiness(prisma, p || null, kind === "orders" ? id : "");
    return { id, productId, packageId: p?.id, revision: p?.revision, status: p?.status || "UNSET", needFixture: p?.needFixture,
      pendingRevision: available[0]?.id !== p?.id ? available[0]?.revision : null, printAllowed, fixtureLabel: readiness.label };
  }));
}
