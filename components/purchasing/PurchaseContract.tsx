"use client";
import { useRef, useState } from "react";
import { pcMoney } from "@/lib/purchasing-domain";
type Contract = {
  id: string;
  number: string;
  revision: number;
  supplier: string;
  purchaser: string;
  terms: string;
  taxNote: string;
  amountCents: number;
  snapshot: unknown;
  createdAt: string;
  actorName: string;
};
type Line = {
  number: string;
  name: string;
  spec: string;
  quantity: number;
  unit: string;
  amountCents: number;
};
export default function PurchaseContract({
  contract: c,
}: {
  contract: Contract;
}) {
  const root = useRef<HTMLDivElement>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lines = c.snapshot as Line[],
    chunks: Array<Line[]> = [];
  for (let i = 0; i < lines.length; i += 16)
    chunks.push(lines.slice(i, i + 16));
  async function pdf() {
    setBusy(true);
    setError("");
    try {
      await document.fonts.ready;
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      const doc = new jsPDF({
        orientation: "p",
        unit: "mm",
        format: "a4",
        compress: true,
      });
      const sheets =
        root.current!.querySelectorAll<HTMLElement>(".contract-page");
      for (let i = 0; i < sheets.length; i++) {
        const canvas = await html2canvas(sheets[i], {
          scale: 2,
          backgroundColor: "#ffffff",
        });
        const maxHeight = Math.floor((canvas.width * 277) / 190);
        let offset = 0;
        while (offset < canvas.height) {
          let height = Math.min(maxHeight, canvas.height - offset);
          if (offset + height < canvas.height) {
            const ctx = canvas.getContext("2d")!;
            for (let back = 0; back < 60; back++) {
              const y = offset + height - back;
              const pixels = ctx.getImageData(0, y, canvas.width, 1).data;
              let clear = true;
              for (let x = 0; x < pixels.length; x += 4)
                if (
                  pixels[x] < 238 ||
                  pixels[x + 1] < 238 ||
                  pixels[x + 2] < 238
                ) {
                  clear = false;
                  break;
                }
              if (clear) {
                height -= back;
                break;
              }
            }
          }
          const page = document.createElement("canvas");
          page.width = canvas.width;
          page.height = height;
          page
            .getContext("2d")!
            .drawImage(
              canvas,
              0,
              offset,
              canvas.width,
              height,
              0,
              0,
              canvas.width,
              height,
            );
          if (i || offset) doc.addPage();
          doc.addImage(
            page.toDataURL("image/png"),
            "PNG",
            10,
            10,
            190,
            (190 * height) / canvas.width,
            undefined,
            "FAST",
          );
          offset += height;
        }
      }
      doc.save(`${c.number}-V${c.revision}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "下载失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="contract-root">
      <div className="contract-toolbar">
        <span>合同存档版本 · 查看和下载不改变业务状态</span>
        <button onClick={() => void pdf()} disabled={busy}>
          {busy ? "正在生成 PDF…" : "下载 PDF"}
        </button>
        <button onClick={() => window.print()}>打印</button>
      </div>
      {error && (
        <p role="alert" style={{ color: "#b53724", textAlign: "center" }}>
          {error}
        </p>
      )}
      <div ref={root}>
        {chunks.map((page, i) => (
          <article className="contract-page" key={i}>
            <h1>物品采购合同</h1>
            <div className="contract-meta">
              <span>合同编号：{c.number}</span>
              <span>
                版本：{c.revision}　日期：{c.createdAt.slice(0, 10)}
              </span>
            </div>
            <p>
              需方：{c.purchaser}
              <br />
              供方：{c.supplier}
            </p>
            <table>
              <thead>
                <tr>
                  <th>物品名称</th>
                  <th>规格型号</th>
                  <th>数量</th>
                  <th>单位</th>
                  <th>合计（元）</th>
                </tr>
              </thead>
              <tbody>
                {page.map((l) => (
                  <tr key={l.number}>
                    <td>{l.name}</td>
                    <td>{l.spec}</td>
                    <td>{l.quantity}</td>
                    <td>{l.unit}</td>
                    <td>{pcMoney(l.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {i === chunks.length - 1 && (
              <>
                <p style={{ textAlign: "right", fontWeight: 700 }}>
                  合同总额：{pcMoney(c.amountCents)}
                </p>
                <p>税率 / 含税口径：{c.taxNote}</p>
                <p>
                  交付、付款及其他约定：
                  <br />
                  {c.terms}
                </p>
                <div className="contract-sign">
                  <span>
                    需方签章：
                    <br />
                    <br />
                    日期：
                  </span>
                  <span>
                    供方签章：
                    <br />
                    <br />
                    日期：
                  </span>
                </div>
              </>
            )}
            <footer>
              第 {i + 1} / {chunks.length} 页 · 制单人 {c.actorName} ·
              对应采购明细已保存为本版快照
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}
