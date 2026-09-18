import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { pcRecord, PurchasingError } from "@/lib/purchasing-domain";
import { purchasingError, purchasingQuery } from "@/lib/purchasing-http";
import {
  loadPurchasing,
  purchasingDetail,
  purchasingLookups,
} from "@/lib/purchasing-queries";
import { mutatePurchasing } from "@/lib/purchasing-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    const actor = await requireUser(),
      q = req.nextUrl.searchParams;
    const data = q.has("lookup")
      ? await purchasingLookups(q)
      : q.get("record")
        ? await purchasingDetail(q.get("record")!, actor)
        : await loadPurchasing(purchasingQuery(q), actor);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return purchasingError(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    const actor = await requireUser();
    if (Number(req.headers.get("content-length") || 0) > 1024 * 1024)
      throw new PurchasingError("采购请求内容过大");
    return NextResponse.json({
      ok: true,
      data: await mutatePurchasing(
        pcRecord(await req.json()),
        actor,
        req.headers.get("idempotency-key"),
      ),
    });
  } catch (e) {
    return purchasingError(e);
  }
}
