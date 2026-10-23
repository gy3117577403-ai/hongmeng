import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { pcIds, pcRecord, PurchasingError } from "@/lib/purchasing-domain";
import { PC_SELECTION_LIMIT } from '@/lib/purchasing-selection';
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
    if (q.has('records')) {
      const ids = pcIds(q.get('records')?.split(','));
      const details = [];
      for (let start = 0; start < ids.length; start += 8) details.push(...await Promise.all(ids.slice(start, start + 8).map(id => purchasingDetail(id, actor))));
      return NextResponse.json({ ok: true, data: details });
    }
    if (q.has('selection')) {
      const data = await loadPurchasing({ ...purchasingQuery(q), page: 1, pageSize: PC_SELECTION_LIMIT + 1 }, actor);
      if (data.total > PC_SELECTION_LIMIT) throw new PurchasingError(`当前筛选有 ${data.total} 项，单次最多选择 ${PC_SELECTION_LIMIT} 项，请缩小筛选范围或分批处理；原选择已保留`);
      return NextResponse.json({ ok: true, data: data.rows });
    }
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
