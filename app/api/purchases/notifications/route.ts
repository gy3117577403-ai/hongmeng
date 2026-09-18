import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { purchasingError } from "@/lib/purchasing-http";
import { pcRecord, pcText, PurchasingError } from "@/lib/purchasing-domain";
import {
  configurePurchasingPush,
  controlPurchasingPush,
  purchasingPushStatus,
} from "@/lib/purchasing-notifications";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    const actor = await requireUser();
    return NextResponse.json({
      ok: true,
      data: await purchasingPushStatus(
        actor,
        req.nextUrl.searchParams.get("record") || undefined,
      ),
    });
  } catch (e) {
    return purchasingError(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    const actor = await requireUser();
    if (Number(req.headers.get("content-length") || 0) > 8000)
      throw new PurchasingError("配置内容过大");
    const body = pcRecord(await req.json());
    if (!["SAVE_CONFIG", "TEST", "RETRY"].includes(String(body.action)))
      throw new PurchasingError("不支持的推送操作");
    const data =
      body.action === "SAVE_CONFIG"
        ? await configurePurchasingPush(body, actor)
        : await controlPurchasingPush(
            body,
            actor,
            pcText(req.headers.get("idempotency-key"), "操作标识", 160),
          );
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return purchasingError(e);
  }
}
