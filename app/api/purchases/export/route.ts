import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireUser } from "@/lib/auth";
import { loadPurchasing } from "@/lib/purchasing-queries";
import { purchasingError, purchasingQuery } from "@/lib/purchasing-http";
import {
  PC_SETTLEMENTS,
  PC_STATES,
  PurchasingError,
} from "@/lib/purchasing-domain";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    const a = await requireUser(),
      q = purchasingQuery(req.nextUrl.searchParams);
    const data = await loadPurchasing({ ...q, page: 1, pageSize: 10000 }, a);
    if (data.total > 10000)
      throw new PurchasingError(
        "当前超过 10000 条，请缩小日期或供应商范围后导出",
      );
    const book = new ExcelJS.Workbook();
    book.creator = a.displayName || a.username;
    const sourceLabel = q.source === "FIXTURE" ? "治具申购" : "普通采购";
    const sheet = book.addWorksheet(sourceLabel);
    const stock = q.view === "stock",
      fund = ["funds", "finance"].includes(q.view || "");
    sheet.columns = (
      stock
        ? [
            "物资编码",
            "物品名称",
            "规格",
            "单位",
            "仓库",
            "库位",
            "当前在库",
            "尚未退库领用量",
          ]
        : fund
          ? [
              "资金单号",
              "收款人",
              "结算方式",
              "申请金额",
              "已付金额",
              "剩余金额",
              "状态",
              "申请日期",
            ]
          : [
              "采购明细号",
              "物品名称",
              "规格",
              "数量",
              "单位",
              "申请人",
              "供应商",
              "结算方式",
              "预算/应付金额",
              "已付款净额",
              "发票金额",
              "已收数量",
              "已退数量",
              "取消待收数量",
              "状态",
              "需求日期",
            ]
    ).map((header, i) => ({
      header,
      key: String(i),
      width: i === 1 || i === 2 ? 25 : 18,
    }));
    for (const r of data.rows)
      sheet.addRow(
        stock
          ? [
              r.number,
              r.name,
              r.spec,
              r.unit,
              r.warehouse,
              r.location,
              r.onHand,
              r.issued,
            ]
          : fund
            ? [
                r.number,
                r.payee,
                PC_SETTLEMENTS[r.settlement],
                r.amountCents / 100,
                r.paidCents / 100,
                r.availableCents / 100,
                PC_STATES[r.status] || r.status,
                r.createdAt.slice(0, 10),
              ]
            : [
                r.number,
                r.name,
                r.spec,
                r.quantity,
                r.unit,
                r.applicantName,
                r.supplier,
                PC_SETTLEMENTS[r.settlement],
                r.amountCents / 100,
                r.paidCents / 100,
                r.invoiceCents / 100,
                r.receivedQty,
                r.returnedQty,
                r.cancelledQty,
                r.completed ? "已完成" : PC_STATES[r.status] || r.status,
                r.needDate,
              ],
      );
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE77332" },
    };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = {
      from: "A1",
      to: { row: 1, column: sheet.columnCount },
    };
    const buffer = await book.xlsx.writeBuffer();
    return new NextResponse(Buffer.from(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(sourceLabel + "记录.xlsx")}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return purchasingError(e);
  }
}
