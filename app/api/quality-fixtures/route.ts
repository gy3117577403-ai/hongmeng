import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { purchasingError } from "@/lib/purchasing-http";
import { pcIds, pcRecord } from "@/lib/purchasing-domain";
import { loadQualityFixtures, qualityFixtureBadges, loadFixtureReviewQueue } from "@/lib/quality-fixture-queries";
import { mutateQualityFixture } from "@/lib/quality-fixture-service";
import { mutatePurchasing } from "@/lib/purchasing-service";
import { FixtureError, scanBom, type BomMapping, type BomSheet } from "@/lib/quality-fixture-domain";
import { prisma } from "@/lib/prisma";
import { processFixtureSyncQueue } from "@/lib/quality-fixture-sync";
import { fixtureSubmissionIssues } from "@/lib/quality-fixture-documents";
import { loadDocumentReturns } from "@/lib/quality-document-returns";
import { moduleFixtureActionAllowed } from "@/lib/module-permissions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    const actor = await requireUser(), q = req.nextUrl.searchParams;
    if (q.has("returns")) return NextResponse.json({ ok: true, data: await loadDocumentReturns(q.get("returns") || "") });
    if (q.has("summary")) {
      const { latest, roles } = await loadFixtureReviewQueue(actor);
      const [supervisor, quality, draft, purchasing] = await Promise.all([
        latest.filter(p => roles.get(p.id)?.includes("SUPERVISOR")).length,
        latest.filter(p => roles.get(p.id)?.includes("QUALITY")).length,
        latest.filter(p => p.status === "RETURNED" || p.status === "DRAFT" && fixtureSubmissionIssues(p).length > 0).length,
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
    if (!moduleFixtureActionAllowed(actor.access, String(input.action))) throw new FixtureError('当前模块权限不能执行此操作', 'FIXTURE_FORBIDDEN', 403);
    if (["RESPOND_RETURN", "RESUBMIT_RETURNS"].includes(String(input.action)) && actor.laborRole !== "ADMIN" &&
      !actor.access.capabilities.some(c => ["ENGINEERING:CREATE", "ENGINEERING:UPDATE", "DRAWING_LIBRARY:CREATE", "DRAWING_LIBRARY:UPDATE"].includes(c)))
      throw new FixtureError("请由有图纸资料维护权限的技术人员处理", "FIXTURE_FORBIDDEN", 403);
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
