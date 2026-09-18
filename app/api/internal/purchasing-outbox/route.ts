import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { dispatchPurchasingPush } from "@/lib/purchasing-notifications";
import { backgroundMaintenanceGate } from "@/lib/maintenance-single-flight";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const expected = Buffer.from(
    process.env.PROCESS_ROUTE_CHANGE_OUTBOX_WORKER_TOKEN || "",
  );
  const actual = Buffer.from(req.headers.get("x-outbox-worker-token") || "");
  if (
    expected.length < 32 ||
    expected.length !== actual.length ||
    !crypto.timingSafeEqual(expected, actual)
  )
    return NextResponse.json({ ok: false }, { status: 404 });
  const flight = await backgroundMaintenanceGate.run(
    { requestId: crypto.randomUUID(), phase: "purchasing_notification_outbox" },
    () => dispatchPurchasingPush(),
  );
  if (!flight.started)
    return NextResponse.json(
      { ok: false, code: "BACKGROUND_MAINTENANCE_ALREADY_RUNNING" },
      { status: 409 },
    );
  return NextResponse.json({ ok: true, result: flight.value });
}
