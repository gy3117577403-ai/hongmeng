import { PurchasingError, pcInt, pcText } from "@/lib/purchasing-domain";

export class FixtureError extends PurchasingError {
  constructor(message: string, code = "FIXTURE_INVALID", status = 400) { super(message, code, status); }
}
export const QF_STATUS: Record<string, string> = {
  DRAFT: "待完善", REVIEWING: "待双方审核", SUPERVISOR: "待主管审核", QUALITY: "待品质审核",
  APPROVED: "资料已审核", RETURNED: "已退回", REVOKED: "已撤销", SUPERSEDED: "已替代",
};
export const QF_REVIEW_STATUSES = ["REVIEWING", "SUPERVISOR", "QUALITY"];
export type QfReviewRole = "SUPERVISOR" | "QUALITY";
type ReviewSignatures = {
  status: string; submittedById?: string | null;
  supervisorId?: string | null; supervisorAt?: Date | string | null; supervisorAsAdmin?: boolean;
  qualityId?: string | null; qualityAt?: Date | string | null; qualityAsAdmin?: boolean;
};
export function fixtureReviewRoles(p: ReviewSignatures | null, actor: { id: string; laborRole?: string },
  settings: { supervisorIds: string[]; qualityIds: string[] } | null, ownsEvidence = false): QfReviewRole[] {
  if (!p || !QF_REVIEW_STATUSES.includes(p.status)) return [];
  const admin = actor.laborRole === "ADMIN";
  if (!admin && (ownsEvidence || p.submittedById === actor.id)) return [];
  return (["SUPERVISOR", "QUALITY"] as const).filter(role => role === "SUPERVISOR"
    ? !p.supervisorAt && (admin || !!settings?.supervisorIds.includes(actor.id) && p.qualityId !== actor.id)
    : !p.qualityAt && (admin || !!settings?.qualityIds.includes(actor.id) && p.supervisorId !== actor.id));
}
// Authorization is captured at signing time so later account changes cannot rewrite history.
export function fixtureSignaturesValid(p: ReviewSignatures): boolean {
  if (!p.supervisorId || !p.qualityId || !p.supervisorAt || !p.qualityAt) return false;
  if (p.supervisorId === p.submittedById && !p.supervisorAsAdmin) return false;
  if (p.qualityId === p.submittedById && !p.qualityAsAdmin) return false;
  if (p.supervisorId === p.qualityId && !p.supervisorAsAdmin && !p.qualityAsAdmin) return false;
  return true;
}
export type BomCell = { text: string; error?: string };
export type BomSheet = { name: string; rows: BomCell[][] };
export type BomMapping = {
  sheet: string; headerRow: number; model: number; name: number; quantity: number;
  manufacturer: number; position: number; unit: number;
  quantityBasis: "PER_UNIT" | "ORDER_TOTAL"; productQuantity: number;
  defaultUnit: string; flattenedConfirmed: boolean;
};
export type BomRow = {
  sourceRow: number; sheet: string; model: string; name: string; manufacturer: string;
  quantity: number | null; quantityText: string; unit: string; position: string;
  include: boolean | null; autoExcluded: boolean; reason: string; flags: string[];
  original: { model: string; quantity: number | null; unit: string; position: string };
};
export type DrawingEvidence = {
  id: string; name: string; version: string; sha256: string; objectKey: string; mimeType: string;
};
export const fixtureKey = (model: string, manufacturer = "") => JSON.stringify([model.trim(), manufacturer.trim()]);
export const fixtureAvailable = (stock: { onHand: number; reserved?: number; held?: number; repair?: number }) =>
  stock.onHand - (stock.reserved || 0) - (stock.held || 0) - (stock.repair || 0);
export function inferBomMapping(sheets: BomSheet[]): BomMapping {
  let sheet = sheets[0], headerRow = 0;
  for (const s of sheets) {
    const found = s.rows.slice(0, 30).findIndex(r =>
      r.some(c => /型号|规格|part.?number/i.test(c.text)) && r.some(c => /数量|用量|qty|quantity/i.test(c.text)));
    if (found >= 0) { sheet = s; headerRow = found; break; }
  }
  if (!sheet) throw new FixtureError("Excel 中没有可读取的工作表");
  const headers = sheet.rows[headerRow] || [];
  const find = (re: RegExp) => headers.findIndex(c => re.test(c.text.replace(/\s/g, "")));
  return {
    sheet: sheet.name, headerRow,
    model: find(/连接器型号|规格型号|物料型号|型号|规格|part.?number/i),
    name: find(/物料名称|名称|品名|类别|description/i),
    quantity: find(/单台用量|用量|数量|qty|quantity/i),
    manufacturer: find(/厂家|制造商|品牌|manufacturer/i),
    position: find(/位号|安装位置|位置|reference/i),
    unit: find(/单位|unit/i), quantityBasis: "PER_UNIT", productQuantity: 1,
    defaultUnit: "个", flattenedConfirmed: false,
  };
}
export function scanBom(sheets: BomSheet[], input: BomMapping): BomRow[] {
  const mapping = input;
  const sheet = sheets.find(s => s.name === mapping.sheet);
  if (!sheet) throw new FixtureError("请选择有效工作表");
  const header = pcInt(mapping.headerRow, "表头行", 0, Math.min(100, sheet.rows.length - 1));
  for (const [key, label] of [["model", "型号"], ["quantity", "数量"]] as const)
    pcInt(mapping[key], label + "列", 0, 79);
  if (mapping.model === mapping.quantity) throw new FixtureError("型号和数量不能对应同一列");
  if (!["PER_UNIT", "ORDER_TOTAL"].includes(mapping.quantityBasis)) throw new FixtureError("请确认数量口径");
  const divisor = mapping.quantityBasis === "ORDER_TOTAL" ? pcInt(mapping.productQuantity, "原 BOM 产品数量", 1, 1000000) : 1;
  const unit = pcText(mapping.defaultUnit, "无单位列时使用的单位", 20);
  const headers = sheet.rows[header].map(c => c.text).join("|");
  if (/层级|父项|父级|level|parent/i.test(headers) && !mapping.flattenedConfirmed)
    throw new FixtureError("检测到多级 BOM，请先确认只纳入实际连接器明细，不重复累计总成和子件");
  const value = (r: BomCell[], col: number) => col >= 0 ? r[col]?.text.trim() || "" : "";
  return sheet.rows.slice(header + 1).map((r, index): BomRow | null => {
    const model = value(r, mapping.model), name = value(r, mapping.name), rawQty = value(r, mapping.quantity);
    if (!model && !name && !rawQty) return null;
    if (/^(合计|总计|小计|备注|说明|total|subtotal)$/i.test(model || name)) return null;
    const n = /^\d+(\.\d+)?$/.test(rawQty) ? Number(rawQty) / divisor : NaN;
    const quantity = Number.isSafeInteger(n) && n > 0 ? n : null;
    const u = value(r, mapping.unit) || unit, position = value(r, mapping.position);
    const autoExcluded = /导线|电线|热缩|胶带|扎带|螺钉|螺丝|包装|端子(?!连接器)/.test(name);
    const positive = /连接器|接插件|插头|插座|connector|receptacle/i.test(name);
    const flags = [!model ? "型号缺失" : "", !quantity ? "数量为空、非正整数或换算不能整除" : "",
      ...[mapping.model, mapping.quantity].flatMap(c => r[c]?.error ? [r[c].error!] : [])].filter(Boolean);
    return { sourceRow: header + index + 2, sheet: sheet.name, model, name,
      manufacturer: value(r, mapping.manufacturer), quantity, quantityText: rawQty, unit: u, position,
      include: autoExcluded ? false : positive ? true : null, autoExcluded, reason: "", flags,
      original: { model, quantity, unit: u, position } };
  }).filter((r): r is BomRow => !!r);
}
export function confirmBomRows(base: BomRow[], proposed: unknown): BomRow[] {
  if (!Array.isArray(proposed) || proposed.length !== base.length)
    throw new FixtureError("识别行发生变化，请重新核对完整清单；排除项必须保留来源");
  const byRow = new Map(proposed.map(r => [Number(r?.sourceRow), r]));
  if (byRow.size !== base.length) throw new FixtureError("来源行重复");
  const rows = base.map(row => {
    const edit = byRow.get(row.sourceRow);
    if (!edit || typeof edit.include !== "boolean") throw new FixtureError("第 " + row.sourceRow + " 行仍待确认是否为连接器");
    const model = pcText(edit.model, "第 " + row.sourceRow + " 行型号", 200, edit.include);
    const quantity = edit.include ? pcInt(edit.quantity, "第 " + row.sourceRow + " 行单台数量", 1, 1000000) : row.quantity;
    const unit = pcText(edit.unit || row.unit, "单位", 20, edit.include);
    if (edit.include && !["个", "只", "件", "套", "PCS", "pcs", "EA", "ea"].includes(unit))
      throw new FixtureError("第 " + row.sourceRow + " 行单位 " + unit + " 尚未确认，请换算为个/件/套");
    const position = pcText(edit.position, "位号", 400, false);
    const corrected = model !== row.model || quantity !== row.quantity || unit !== row.unit || position !== row.position;
    const reason = pcText(edit.reason, "第 " + row.sourceRow + " 行修改/排除依据", 500,
      corrected || (!edit.include && !row.autoExcluded) || (edit.include && row.flags.length > 0));
    return { ...row, model, quantity, unit, position, include: edit.include, reason };
  });
  const included = rows.filter(r => r.include);
  if (!included.length) throw new FixtureError("需要治具时至少确认一个连接器，零识别不能提交");
  const positions = new Set<string>();
  for (const row of included) for (const position of row.position.split(/[,，、/;；\s]+/).filter(Boolean)) {
    if (positions.has(position)) throw new FixtureError("位号 " + position + " 重复，请核对来源行，避免重复计量");
    positions.add(position);
  }
  return rows;
}
export function fixtureRequirements(rows: BomRow[], parallel: number, spare: number) {
  const groups = new Map<string, { key: string; model: string; manufacturer: string; unit: string; perUnit: number; required: number; rows: number[] }>();
  for (const row of rows.filter(r => r.include)) {
    const key = fixtureKey(row.model, row.manufacturer);
    const current = groups.get(key) || { key, model: row.model, manufacturer: row.manufacturer, unit: row.unit, perUnit: 0, required: 0, rows: [] };
    if (current.unit !== row.unit) throw new FixtureError(row.model + "存在不同单位，不能直接汇总");
    current.perUnit += row.quantity || 0; current.rows.push(row.sourceRow); groups.set(key, current);
  }
  return [...groups.values()].map(g => ({ ...g, required: pcInt(g.perUnit * parallel + spare, "治具需求", 1, 1000000) }));
}
