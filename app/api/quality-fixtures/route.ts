import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { purchasingError } from "@/lib/purchasing-http";
import { pcIds, pcRecord } from "@/lib/purchasing-domain";
import { loadQualityFixtures, qualityFixtureBadges } from "@/lib/quality-fixture-queries";
import { mutateQualityFixture } from "@/lib/quality-fixture-service";
import { mutatePurchasing } from "@/lib/purchasing-service";
import { FixtureError, scanBom, type BomMapping, type BomSheet } from "@/lib/quality-fixture-domain";
import { prisma } from "@/lib/prisma";
import { processFixtureSyncQueue } from "@/lib/quality-fixture-sync";
import { fixturePlanScope } from "@/lib/quality-fixture-scope";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    const actor = await requireUser(), q = req.nextUrl.searchParams;
    if (q.has("summary")) {
      const settings = await prisma.qfSettings.findUnique({ where: { id: "quality-fixtures" } });
      const latest = await prisma.qfPackage.findMany({ where: { libraryItem: fixturePlanScope }, distinct: ["libraryItemId"], orderBy: [{ libraryItemId: "asc" }, { sequence: "desc" }], select: { id: true } });
      const scope = { id: { in: latest.map(p => p.id) } };
      const [supervisor, quality, draft, purchasing] = await Promise.all([
        settings?.supervisorIds.includes(actor.id) ? prisma.qfPackage.count({ where: { ...scope, status: "SUPERVISOR", submittedById: { not: actor.id } } }) : 0,
        settings?.qualityIds.includes(actor.id) ? prisma.qfPackage.count({ where: { ...scope, status: "QUALITY", submittedById: { not: actor.id }, supervisorId: { not: actor.id } } }) : 0,
        prisma.qfPackage.count({ where: { ...scope, status: { in: ["DRAFT", "RETURNED"] } } }),
        prisma.pcLine.count({ where: { request: { source: "FIXTURE", deletedAt: null }, completedAt: null, status: { in: ["PENDING", "APPROVED", "ORDERED"] } } }),
      ]);
      return NextResponse.json({ ok: true, data: { supervisor, quality, draft, purchasing } });
    }
    const data = q.has("badges") ? await qualityFixtureBadges(pcIds((q.get("badges") || "").split(","), "产品 / 工单"), q.get("kind") || "products") : await loadQualityFixtures(q, actor);
    return NextResponse.json({ ok: true, data });
  } catch (e) { return purchasingError(e); }
}
export async function POST(req: NextRequest) {
  try {
    const actor = await requireUser();
    if (Number(req.headers.get("content-length") || 0) > 4 * 1024 * 1024) throw new FixtureError("资料内容过大");
    const input = pcRecord(await req.json());
    if (input.action === "SYNC_DOCUMENTS") return NextResponse.json({ ok: true, data: await processFixtureSyncQueue(60) });
    if (input.action === "SCAN_BOM") {
      const bom = await prisma.qfBomFile.findFirst({ where: { id: String(input.id), deletedAt: null } });
      if (!bom) throw new FixtureError("BOM 不存在");
      return NextResponse.json({ ok: true, data: scanBom(bom.sheets as unknown as BomSheet[], input.mapping as unknown as BomMapping) });
    }
    const data = input.action === "CREATE_FIXTURE_PURCHASE" ? await mutatePurchasing(input, actor, req.headers.get("idempotency-key")) :
      await mutateQualityFixture(input, actor, req.headers.get("idempotency-key"));
    return NextResponse.json({ ok: true, data });
  } catch (e) { return purchasingError(e); }
}
