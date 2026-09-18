import { NextResponse } from "next/server";
import {
  ForbiddenError,
  UnauthorizedError,
  forbidden,
  unauthorized,
} from "@/lib/auth";
import { PurchasingError } from "@/lib/purchasing-domain";
import type { PcQuery } from "@/lib/purchasing-queries";
export function purchasingError(error: unknown) {
  if (error instanceof UnauthorizedError) return unauthorized();
  if (error instanceof ForbiddenError) return forbidden();
  if (error instanceof PurchasingError)
    return NextResponse.json(
      { ok: false, error: error.message, code: error.code },
      { status: error.status },
    );
  if (error instanceof SyntaxError)
    return NextResponse.json(
      { ok: false, error: "请求格式错误" },
      { status: 400 },
    );
  console.error("[purchasing]", error);
  return NextResponse.json(
    { ok: false, error: "采购操作失败，请保留输入并重试" },
    { status: 500 },
  );
}
export function purchasingQuery(p: URLSearchParams): PcQuery {
  return {
    view: p.get("view") || "all",
    task: p.get("task") || "",
    q: p.get("q") || "",
    urgency: p.get("urgency") || "",
    settlement: p.get("settlement") || "",
    supplierId: p.get("supplierId") || "",
    from: p.get("from") || "",
    to: p.get("to") || "",
    mine: p.get("mine") === "1",
    follow: p.get("follow") || "",
    sort: p.get("sort") || "",
    page: Number(p.get("page")) || 1,
    pageSize: Number(p.get("pageSize")) || 12,
    ids: p.get("ids")?.split(",").filter(Boolean),
  };
}
