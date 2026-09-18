import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { purchasingError } from "@/lib/purchasing-http";
import { purchasingHomeSummary } from "@/lib/purchasing-queries";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      data: await purchasingHomeSummary(await requireUser()),
    });
  } catch (e) {
    return purchasingError(e);
  }
}
