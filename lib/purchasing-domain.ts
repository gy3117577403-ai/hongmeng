export type PcInput = Record<string, unknown>;
export class PurchasingError extends Error {
  constructor(
    message: string,
    public code = "PURCHASING_INVALID",
    public status = 400,
  ) {
    super(message);
  }
}
export const PC_VIEWS = [
  { id: "all", label: "全部采购" },
  { id: "approval", label: "采购审批" },
  { id: "execution", label: "采购执行" },
  { id: "funds", label: "资金审批" },
  { id: "finance", label: "财务打款" },
  { id: "documents", label: "票据 / 退款" },
  { id: "completed", label: "已完成" },
  { id: "stock", label: "物资台账" },
  { id: "drafts", label: "草稿箱" },
];
export const PC_SETTLEMENTS: Record<string, string> = {
  CORPORATE: "对公现结",
  ADVANCE: "采购垫付",
  MONTHLY: "月结",
};
export const PC_STATES: Record<string, string> = {
  DRAFT: "草稿",
  PENDING: "待审批",
  APPROVED: "已通过 / 待采购",
  RETURNED: "退回修改",
  WITHDRAWN: "已撤回",
  ORDERED: "已采购",
  VOID: "已作废",
  PARTIAL: "部分付款",
  PAID: "已付款",
  CLOSED: "已关闭",
};
export const pcMoney = (value: number) =>
  `¥${(value / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const pcRecord = (v: unknown): PcInput => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new PurchasingError("请求格式错误");
  return v as PcInput;
};
export function pcText(
  v: unknown,
  label: string,
  max = 200,
  required = true,
): string {
  const s = typeof v === "string" ? v.trim() : "";
  if ((required && !s) || s.length > max)
    throw new PurchasingError(
      `${label}${!s ? "不能为空" : `不能超过 ${max} 个字符`}`,
    );
  return s;
}
export function pcInt(
  v: unknown,
  label: string,
  min = 1,
  max = 1000000000,
): number {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string" && v.trim()
        ? Number(v)
        : NaN;
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw new PurchasingError(`${label}必须是 ${min} 至 ${max} 之间的整数`);
  return n;
}
export function pcCents(v: unknown, label = "金额"): number {
  const s = String(v ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s))
    throw new PurchasingError(`${label}最多保留两位小数`);
  const [a, b = ""] = s.split(".");
  return pcInt(Number(a) * 100 + Number(b.padEnd(2, "0")), label, 0);
}
export function pcDate(v: unknown, label = "日期"): string {
  const s = pcText(v, label, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(Date.parse(s + "T00:00:00Z")) ||
    new Date(s + "T00:00:00Z").toISOString().slice(0, 10) !== s
  )
    throw new PurchasingError(`${label}无效`);
  return s;
}
export function pcChoice(v: unknown, allowed: string[], label: string): string {
  const s = pcText(v, label);
  if (!allowed.includes(s)) throw new PurchasingError(`${label}无效`);
  return s;
}
export function pcIds(v: unknown, label = "记录"): string[] {
  if (!Array.isArray(v) || !v.length || v.length > 100)
    throw new PurchasingError(`请选择 1 至 100 条${label}`);
  const ids = v.map((x) => pcText(x, label, 100));
  if (new Set(ids).size !== ids.length)
    throw new PurchasingError(`${label}不能重复`);
  return ids;
}
export function pcVersion(actual: number, expected: unknown) {
  if (actual !== expected)
    throw new PurchasingError(
      "记录已被更新，请刷新后核对重试",
      "PURCHASING_CONFLICT",
      409,
    );
}
export function pcSplit(total: number, weights: number[]): number[] {
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    weights.some((w) => !Number.isSafeInteger(w) || w < 0) ||
    !weights.length
  )
    throw new PurchasingError("分摊金额无效");
  const all = weights.reduce((s, n) => s + n, 0);
  if (all === 0) {
    if (total) throw new PurchasingError("没有可分摊金额");
    return weights.map(() => 0);
  }
  const t = BigInt(total),
    w = BigInt(all);
  const values = weights.map((x) => Number((t * BigInt(x)) / w));
  const order = weights
    .map((x, i) => ({ i, rest: (t * BigInt(x)) % w }))
    .sort((a, b) => (a.rest === b.rest ? a.i - b.i : a.rest > b.rest ? -1 : 1));
  for (let i = 0, n = total - values.reduce((s, x) => s + x, 0); i < n; i++)
    values[order[i].i]++;
  return values;
}
export function pcMask(account: string) {
  return account.length <= 4 ? "****" : `**** ${account.slice(-4)}`;
}
export type PcLineFact = {
  status: string;
  quantity: number;
  receivedQty: number;
  cancelledQty: number;
  payableCents: number;
  reservedCents: number;
  paidCents: number;
  refundedCents: number;
  invoiceCents: number;
  refundOpen?: number;
};
export function pcComplete(p: PcLineFact) {
  return (
    p.status === "ORDERED" &&
    p.receivedQty + p.cancelledQty === p.quantity &&
    p.paidCents - p.refundedCents === p.payableCents &&
    p.invoiceCents === p.payableCents &&
    !p.refundOpen
  );
}
export function pcFundingKey(p: {
  settlement: string;
  payee: string;
  payeeUserId: string | null;
  bank: string;
  account: string;
  supplierId: string | null;
  currency: string;
  cycle: string;
}) {
  return JSON.stringify([
    p.settlement,
    p.payee,
    p.payeeUserId,
    p.bank,
    p.account,
    p.currency,
    p.settlement === "ADVANCE" ? "" : p.supplierId,
    p.settlement === "MONTHLY" ? p.cycle : "",
  ]);
}
export type PcRow = {
  id: string;
  kind: string;
  number: string;
  version: number;
  name: string;
  spec: string;
  quantity: number;
  unit: string;
  amountCents: number;
  status: string;
  applicantName: string;
  supplier: string;
  settlement: string;
  payee: string;
  account: string;
  needDate: string;
  urgency: string;
  receivedQty: number;
  cancelledQty: number;
  returnedQty: number;
  availableCents: number;
  paidCents: number;
  invoiceCents: number;
  refundOpen: number;
  completed: boolean;
  createdAt: string;
  requestId: string;
  purpose: string;
  eta: string;
  onHand?: number;
  issued?: number;
  warehouse?: string;
  location?: string;
  itemNumber?: string;
  lineId?: string;
};
export type PcWorkbench = {
  rows: PcRow[];
  total: number;
  totalCents: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
  settings: null | {
    ownerId: string;
    purchaseApproverIds: string[];
    fundApproverIds: string[];
    financeIds: string[];
    buyerIds: string[];
    version: number;
  };
  users: {
    id: string;
    name: string;
  }[];
  suppliers: {
    id: string;
    name: string;
  }[];
  permissions: {
    configure: boolean;
    approvePurchase: boolean;
    approveFund: boolean;
    finance: boolean;
    buy: boolean;
  };
};
