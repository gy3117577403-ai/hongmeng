"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDownToLine,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings,
  X,
} from "lucide-react";
import { AppWorkbenchHeader } from "@/components/layout/AppWorkbenchHeader";
import {
  PC_VIEWS,
  PC_SETTLEMENTS,
  PC_STATES,
  pcCents,
  pcMoney,
  type PcInput,
  type PcRow,
  type PcWorkbench,
} from "@/lib/purchasing-domain";
import type { PcDetail } from "@/lib/purchasing-queries";
import type { CurrentUserDTO } from "@/types";

type LineDetail = Extract<PcDetail, { kind: "line" }>["record"];
type FundDetail = Extract<PcDetail, { kind: "fund" }>["record"];
type RequestLine = {
  id?: string;
  version?: number;
  name: string;
  spec: string;
  unit: string;
  quantity: string;
  amount: string;
  category: string;
  urgency: string;
  needDate: string;
  referenceUrl: string;
};
type Dialog = {
  action: string;
  rows: PcRow[];
  lines: LineDetail[];
  fund?: FundDetail;
  requestId?: string;
  requestVersion?: number;
  requestDraft?: boolean;
  returnId?: string;
  returnVersion?: number;
};
const today = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
const blankLine = (): RequestLine => ({
  name: "",
  spec: "",
  unit: "件",
  quantity: "1",
  amount: "",
  category: "生产工具",
  urgency: "NORMAL",
  needDate: today(),
  referenceUrl: "",
});
const titles: Record<string, string> = {
  SAVE_REQUEST: "发起采购申请",
  EDIT_REQUEST: "修改采购申请",
  SAVE_SETTINGS: "采购流程设置",
  APPROVE_LINES: "通过采购审批",
  RETURN_LINES: "退回采购申请",
  WITHDRAW_LINES: "撤回申请",
  VOID_LINES: "作废采购",
  PURCHASE: "登记采购信息",
  CREATE_FUND: "发起请款 / 报销",
  APPROVE_FUNDS: "通过资金审批",
  RETURN_FUNDS: "退回资金申请",
  WITHDRAW_FUND: "撤回资金申请",
  CLOSE_FUND: "关闭未付款余额",
  PAY: "登记实际付款",
  OFFLINE_PAYMENT: "补录线下已付款",
  RECEIVE: "登记收货入库",
  RETURN_GOODS: "办理采购退货",
  REFUND: "确认供应商退款",
  REFUND_HANDOVER: "确认个人归还公司",
  INVOICE: "登记发票 / 红冲",
  CONTRACT: "生成采购合同",
  ISSUE: "物资领用",
  RESTOCK: "领用退库",
  ADJUST_STOCK: "库存调整",
  NOTE: "补充采购备注",
  ATTACH_FILES: "补充业务附件",
};
const eventNames: Record<string, string> = {
  SUBMIT: "提交申请",
  RESUBMIT: "修改并重新提交",
  SAVE_DRAFT: "保存草稿",
  APPROVE: "采购审批通过",
  RETURN: "退回修改",
  PURCHASE: "登记采购",
  REVISE_PURCHASE: "修订采购",
  CREATE_FUND: "申请资金",
  OFFLINE_FUND: "补录付款申请",
  PAY: "登记付款",
  RECEIVE: "收货入库",
  RETURN_GOODS: "采购退货",
  REFUND: "供应商退款到账",
  REFUND_HANDOVER: "退款归还公司",
  INVOICE: "登记发票",
  NOTE: "更新备注",
  ATTACH_FILES: "补充附件",
  ISSUE: "物资领用",
  RESTOCK: "领用退库",
  ADJUST_STOCK: "调整库存",
  CREATE: "生成合同",
};
const time = (v: string) =>
  new Date(v).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
const yuan = (n: number) => String(n / 100);
const sum = (rs: PcRow[], key: "amountCents" | "availableCents") =>
  rs.reduce((s, r) => s + r[key], 0);
async function response<T>(r: Response): Promise<T> {
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "操作失败，请重试");
  return j.data as T;
}
function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={wide ? "pc-field pc-wide" : "pc-field"}>
      <span>{label}</span>
      {children}
    </label>
  );
}
function Facts({ children }: { children: ReactNode }) {
  return <dl className="pc-facts">{children}</dl>;
}
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children || "—"}</dd>
    </div>
  );
}

export default function PurchasingWorkbench({
  user,
  initialData,
  initialView,
  initialRecord,
}: {
  user: CurrentUserDTO;
  initialData: PcWorkbench;
  initialView: string;
  initialRecord: string;
}) {
  const [data, setData] = useState(initialData),
    [view, setView] = useState(initialView),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const [filters, setFilters] = useState({
      settlement: "",
      urgency: "",
      supplierId: "",
      from: "",
      to: "",
      follow: "",
      mine: "",
      sort: "",
    }),
    [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]),
    [activeId, setActiveId] = useState(initialRecord),
    [detail, setDetail] = useState<PcDetail | null>(null);
  const [detailTab, setDetailTab] = useState("overview"),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [form, setForm] = useState<Record<string, string>>({});
  const [requestLines, setRequestLines] = useState<RequestLine[]>([
      blankLine(),
    ]),
    [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [files, setFiles] = useState<{ id: string; originalName: string }[]>(
      [],
    ),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [loading, setLoading] = useState(false);
  const [error, setError] = useState(""),
    [formError, setFormError] = useState(""),
    [message, setMessage] = useState(""),
    [revision, setRevision] = useState(0);
  const [workorders, setWorkorders] = useState<{ id: string; code: string }[]>(
      [],
    ),
    [itemOptions, setItemOptions] = useState<
      { id: string; number: string; name: string; spec: string; unit: string }[]
    >([]);
  const busyRef = useRef(false),
    mutation = useRef<{ body: string; key: string } | null>(null),
    formRef = useRef<HTMLDivElement>(null),
    previousFocus = useRef<HTMLElement | null>(null);
  const params = useCallback(
    () =>
      new URLSearchParams({
        view,
        q: query,
        ...filters,
        page: String(page),
        pageSize: "12",
      }),
    [view, query, filters, page],
  );
  const selectedRows = data.rows.filter((r) => selected.includes(r.id));
  const changeFilter = (key: keyof typeof filters, value: string) => {
    setFilters((p) => ({ ...p, [key]: value }));
    setPage(1);
    setSelected([]);
  };
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search);
      setPage(1);
      setSelected([]);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch("/api/purchases?" + params(), { signal: controller.signal })
      .then(response<PcWorkbench>)
      .then((v) => {
        setData(v);
        setError("");
        if (v.page > 1 && !v.rows.length && v.total)
          setPage(Math.ceil(v.total / v.pageSize));
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [params, revision]);
  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    const c = new AbortController();
    setDetail(null);
    fetch("/api/purchases?record=" + encodeURIComponent(activeId), {
      signal: c.signal,
    })
      .then(response<PcDetail>)
      .then(setDetail)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [activeId, revision]);
  useEffect(() => {
    if (!dialog) return;
    previousFocus.current = document.activeElement as HTMLElement;
    const t = setTimeout(
      () =>
        formRef.current
          ?.querySelector<HTMLInputElement>("input,select,textarea,button")
          ?.focus(),
      0,
    );
    return () => {
      clearTimeout(t);
      previousFocus.current?.focus();
    };
  }, [dialog]);
  useEffect(() => {
    if (!dialog) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyRef.current) {
        setDialog(null);
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = Array.from(
        formRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
        ) || [],
      );
      if (e.shiftKey && document.activeElement === nodes[0]) {
        e.preventDefault();
        nodes.at(-1)?.focus();
      } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
        e.preventDefault();
        nodes[0]?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [dialog]);
  const set = (key: string, value: string) =>
    setForm((p) => ({ ...p, [key]: value }));
  const input = (
    key: string,
    type = "text",
    placeholder = "",
    required = false,
  ) => (
    <input
      aria-label={placeholder || undefined}
      type={type}
      value={form[key] || ""}
      placeholder={placeholder}
      required={required}
      step={type === "number" ? "0.01" : undefined}
      onChange={(e) => set(key, e.target.value)}
    />
  );
  const select = (key: string, options: Record<string, string>) => (
    <select value={form[key] || ""} onChange={(e) => set(key, e.target.value)}>
      {Object.entries(options).map(([id, name]) => (
        <option key={id} value={id}>
          {name}
        </option>
      ))}
    </select>
  );
  const userSelect = (key: string, empty = "请选择人员") =>
    select(key, {
      "": empty,
      ...Object.fromEntries(data.users.map((u) => [u.id, u.name])),
    });
  const openDetail = (id: string) => {
    setActiveId(id);
    setDetailTab("overview");
  };
  function rowFromLine(p: LineDetail): PcRow {
    return {
      id: p.id,
      kind: "line",
      number: p.number,
      version: p.version,
      name: p.name,
      spec: p.spec,
      quantity: p.quantity,
      unit: p.unit,
      amountCents: p.status === "ORDERED" ? p.payableCents : p.estimateCents,
      status: p.status,
      applicantName: p.request.applicantName,
      supplier: p.supplier?.name || "",
      settlement: p.settlement,
      payee: p.payee,
      account: p.account,
      needDate: p.needDate,
      urgency: p.urgency,
      receivedQty: p.receivedQty,
      cancelledQty: p.cancelledQty,
      returnedQty: p.returnedQty,
      availableCents: Math.max(0, p.payableCents - p.reservedCents),
      paidCents: p.paidCents - p.refundedCents,
      invoiceCents: p.invoiceCents,
      refundOpen: 0,
      completed: !!p.completedAt,
      createdAt: p.createdAt,
      requestId: p.requestId,
      purpose: p.request.purpose,
      eta: p.eta,
    };
  }
  async function open(
    action: string,
    rows: PcRow[] = [],
    extra?: { returnId?: string },
  ) {
    if (busyRef.current) return;
    setFormError("");
    setError("");
    setFiles([]);
    mutation.current = null;
    try {
      const details = await Promise.all(
        rows
          .filter((r) => r.kind !== "stock")
          .map((r) =>
            fetch("/api/purchases?record=" + r.id).then(response<PcDetail>),
          ),
      );
      const lines = details.flatMap((d) =>
          d.kind === "line" ? [d.record] : [],
        ),
        fund = details.find(
          (d): d is Extract<PcDetail, { kind: "fund" }> => d.kind === "fund",
        )?.record;
      const p = lines[0],
        r = rows[0];
      const currentRows = rows.map((row) => {
        const l = lines.find((l) => l.id === row.id);
        return l
          ? rowFromLine(l)
          : fund?.id === row.id
            ? {
                ...row,
                number: fund.number,
                name: fund.payee,
                amountCents: fund.amountCents,
                paidCents: fund.paidCents,
                version: fund.version,
                availableCents: fund.amountCents - fund.paidCents,
              }
            : row;
      });
      const returned = p?.returns.find((x) => x.id === extra?.returnId);
      const f: Record<string, string> = {
        date: today(),
        applicantId: user.id,
        buyerId: user.id,
        receiverId: user.id,
        settlement: p?.settlement || "CORPORATE",
        supplier: p?.supplier?.name || "",
        payee: p?.payee || fund?.payee || "",
        payeeUserId: p?.payeeUserId || "",
        bank: p?.bank || fund?.bank || "",
        account: p?.account || fund?.account || "",
        eta: p?.eta || today(),
        cycle: p?.cycle || today().slice(0, 7),
        dueDate: p?.dueDate || "",
        warehouse: "采购物资仓",
        location: "待上架区",
        adjustment: "NONE",
        kind: "NORMAL",
        direction: "OUT",
        destination: "COMPANY",
        quantity: "1",
        amount: yuan(
          sum(
            currentRows,
            action === "CREATE_FUND" ||
              action === "OFFLINE_PAYMENT" ||
              action === "PAY"
              ? "availableCents"
              : "amountCents",
          ),
        ),
        reason: "",
        note: p?.note || "",
        ownerId: data.settings?.ownerId || user.id,
      };
      for (const l of lines) {
        f["actual:" + l.id] = yuan(l.actualCents || l.estimateCents);
        f["quantity:" + l.id] = String(
          l.quantity - l.receivedQty - l.cancelledQty,
        );
        f["item:" + l.id] = l.itemId || "";
      }
      if (action === "INVOICE") {
        const credit = lines.every((l) => l.invoiceCents > l.payableCents);
        f.kind = credit ? "CREDIT" : "NORMAL";
        f.amount = yuan(
          lines.reduce(
            (s, l) => s + Math.abs(l.payableCents - l.invoiceCents),
            0,
          ),
        );
      }
      if (action === "RETURN_GOODS" && p) {
        f.kind = p.receivedQty - p.returnedQty > 0 ? "STOCK" : "UNRECEIVED";
        f.stockId = p.balances.find((b) => b.onHand > 0)?.id || "";
        f.quantity = "1";
        f.amount = yuan(
          Math.round(
            p.payableCents / (p.quantity - p.returnedQty - p.cancelledQty),
          ),
        );
      }
      if (returned) {
        f.amount = yuan(
          action === "REFUND_HANDOVER"
            ? returned.refundedCents - returned.companyReceivedCents
            : returned.refundDueCents - returned.refundedCents,
        );
      }
      if (action === "CONTRACT") {
        f.contractNumber = "";
        f.purchaser = "杭连电子";
        f.terms = "";
        f.taxNote = "按双方确认的含税金额执行";
      }
      if (action === "EDIT_REQUEST" && p) {
        f.applicantId = p.request.applicantId;
        f.purpose = p.request.purpose;
        f.workOrderId = p.request.workOrderId || "";
        setRequestLines(
          p.request.lines
            .filter((l) =>
              ["DRAFT", "RETURNED", "WITHDRAWN"].includes(l.status),
            )
            .map((l) => ({
              ...l,
              quantity: String(l.quantity),
              amount: yuan(l.estimateCents),
            })),
        );
      } else if (action === "SAVE_REQUEST") setRequestLines([blankLine()]);
      if (action === "SAVE_SETTINGS")
        setAssignments(
          Object.fromEntries(
            [
              "purchaseApproverIds",
              "buyerIds",
              "fundApproverIds",
              "financeIds",
            ].map((k) => [k, data.settings?.[k as "buyerIds"] || []]),
          ),
        );
      setForm(f);
      setDialog({
        action,
        rows: currentRows,
        lines,
        fund,
        requestId: action === "EDIT_REQUEST" ? p?.requestId : undefined,
        requestVersion: p?.request.version,
        requestDraft: p?.request.status === "DRAFT",
        returnId: returned?.id,
        returnVersion: returned?.version,
      });
      if (["SAVE_REQUEST", "EDIT_REQUEST"].includes(action))
        setWorkorders(
          await fetch("/api/purchases?lookup=1&type=workorders").then(
            response<{ id: string; code: string }[]>,
          ),
        );
      if (action === "PURCHASE")
        setItemOptions(
          await fetch("/api/purchases?lookup=1&type=items").then(
            response<typeof itemOptions>,
          ),
        );
      if (r?.kind === "stock") {
        set("quantity", "1");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载操作数据失败");
    }
  }
  async function loadAccountHistory() {
    try {
      const q = new URLSearchParams({
        lookup: "1",
        type: "accounts",
        settlement: form.settlement,
        supplier: form.supplier,
        payeeUserId: form.payeeUserId,
      });
      const previous = await fetch("/api/purchases?" + q).then(
        response<{ payee: string; bank: string; account: string } | null>,
      );
      if (!previous) {
        setFormError("尚无该供应商或垫付人的历史账户，请手动填写");
        return;
      }
      setForm((f) => ({
        ...f,
        payee: previous.payee,
        bank: previous.bank,
        account: previous.account,
      }));
      setFormError("");
    } catch (e) {
      setFormError(String(e));
    }
  }
  async function upload(list: FileList | null) {
    if (!list) return;
    setUploading(true);
    setFormError("");
    try {
      for (const file of Array.from(list)) {
        const body = new FormData();
        body.append("file", file);
        const saved = await fetch("/api/purchases/attachments", {
          method: "POST",
          body,
        }).then(response<{ id: string; originalName: string }>);
        setFiles((p) => [...p, saved]);
      }
    } catch (e) {
      setFormError(
        e instanceof Error ? e.message : "上传失败，已上传的附件已保留",
      );
    } finally {
      setUploading(false);
    }
  }
  async function submit(draft = false) {
    if (!dialog || busyRef.current || uploading) return;
    setFormError("");
    let payload: PcInput;
    try {
      const d = dialog,
        action = d.action === "EDIT_REQUEST" ? "SAVE_REQUEST" : d.action;
      const entries = d.rows.map((r) => ({ id: r.id, version: r.version }));
      payload = {
        ...form,
        action,
        entries,
        attachmentIds: files.map((f) => f.id),
      };
      if (action === "SAVE_SETTINGS")
        payload = {
          ...payload,
          ...assignments,
          version: data.settings?.version,
        };
      if (action === "SAVE_REQUEST")
        payload = {
          ...payload,
          submit: !draft,
          requestId: d.requestId,
          version: d.requestVersion,
          replaceDraft: true,
          lines: requestLines.map((l) => ({
            ...l,
            quantity: Number(l.quantity),
            estimateCents: pcCents(l.amount || "0", "预算合计"),
          })),
        };
      if (
        [
          "CREATE_FUND",
          "PAY",
          "OFFLINE_PAYMENT",
          "RETURN_GOODS",
          "REFUND",
          "REFUND_HANDOVER",
          "INVOICE",
        ].includes(action)
      )
        payload.amountCents = pcCents(form.amount);
      if (action === "PURCHASE") {
        payload.entries = d.rows.map((r) => ({
          id: r.id,
          version: r.version,
          actualCents: pcCents(form["actual:" + r.id]),
          itemId: form["item:" + r.id],
        }));
        payload.contractAttachmentIds = files.map((f) => f.id);
      }
      if (action === "CONTRACT")
        payload.contractAttachmentIds = files.map((f) => f.id);
      if (action === "RECEIVE")
        payload.entries = d.rows.map((r) => ({
          id: r.id,
          version: r.version,
          quantity: Number(form["quantity:" + r.id]),
        }));
      if (
        [
          "PAY",
          "RETURN_GOODS",
          "NOTE",
          "ATTACH_FILES",
          "ISSUE",
          "RESTOCK",
          "ADJUST_STOCK",
        ].includes(action)
      ) {
        payload.id = d.rows[0].id;
        payload.version = d.rows[0].version;
      }
      if (action === "RETURN_GOODS") {
        payload.quantity = Number(form.quantity);
        payload.stockVersion = d.lines[0]?.balances.find(
          (b) => b.id === form.stockId,
        )?.version;
      }
      if (["ISSUE", "RESTOCK", "ADJUST_STOCK"].includes(action))
        payload.quantity = Number(form.quantity);
      if (["REFUND", "REFUND_HANDOVER"].includes(action)) {
        payload.id = d.returnId;
        payload.version = d.returnVersion;
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "请核对输入");
      return;
    }
    const body = JSON.stringify(payload);
    if (mutation.current?.body !== body)
      mutation.current = { body, key: crypto.randomUUID() };
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await fetch("/api/purchases", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": mutation.current.key,
        },
        body,
      }).then(response<{ id?: string; duplicates?: unknown[] }>);
      setDialog(null);
      setSelected([]);
      setRevision((n) => n + 1);
      setMessage(
        payload.action === "SAVE_REQUEST"
          ? payload.submit
            ? "采购申请已提交"
            : "草稿已保存"
          : `${titles[String(payload.action)]}已完成`,
      );
      if (result.duplicates?.length)
        setMessage(
          "申请已提交；发现近 30 天相同名称的未完成采购，请在全部采购中核对是否重复。",
        );
      mutation.current = null;
    } catch (e) {
      setFormError(
        e instanceof Error ? e.message : "保存失败，输入已保留。请重试",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function exportRows() {
    try {
      const q = params();
      if (selected.length) q.set("ids", selected.join(","));
      const r = await fetch("/api/purchases/export?" + q);
      if (!r.ok) {
        await response(r);
        return;
      }
      const url = URL.createObjectURL(await r.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = `采购${PC_VIEWS.find((v) => v.id === view)?.label}-${today()}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出失败");
    }
  }
  const actions = (rows: PcRow[], compact = false) => {
    if (!rows.length) return null;
    const all = (s: string[]) => rows.every((r) => s.includes(r.status));
    const line = rows.every((r) => r.kind === "line"),
      fund = rows.every((r) => r.kind === "fund"),
      stock = rows.length === 1 && rows[0].kind === "stock";
    const btn = (action: string, label: string, primary = false) => (
      <button
        key={action}
        className={primary ? "pc-primary" : ""}
        onClick={() => void open(action, rows)}
      >
        {label}
      </button>
    );
    return (
      <div className="pc-actions">
        {line && all(["PENDING"]) && data.permissions.approvePurchase && (
          <>
            {btn("APPROVE_LINES", "通过审批", true)}
            {btn("RETURN_LINES", "退回")}
          </>
        )}
        {line &&
          all(["DRAFT", "RETURNED", "WITHDRAWN"]) &&
          rows.length === 1 &&
          btn("EDIT_REQUEST", "修改并提交", true)}
        {line &&
          all(["PENDING", "DRAFT", "RETURNED"]) &&
          btn("WITHDRAW_LINES", "撤回申请")}
        {line &&
          all(["APPROVED", "ORDERED"]) &&
          data.permissions.buy &&
          btn(
            "PURCHASE",
            all(["ORDERED"]) ? "修订采购" : "登记采购",
            all(["APPROVED"]),
          )}
        {line && all(["ORDERED"]) && (
          <>
            {rows.every((r) => r.availableCents > 0) &&
              btn("CREATE_FUND", "申请资金", true)}
            {rows.every((r) => r.receivedQty + r.cancelledQty < r.quantity) &&
              btn("RECEIVE", "收货入库", true)}
            {btn("INVOICE", "登记发票")}
            {rows.length === 1 && btn("RETURN_GOODS", "退货")}
            {data.permissions.finance &&
              rows.every((r) => r.availableCents > 0) &&
              btn("OFFLINE_PAYMENT", "补录已付款")}
          </>
        )}
        {line &&
          all(["APPROVED", "ORDERED"]) &&
          data.permissions.buy &&
          btn("CONTRACT", "生成合同")}
        {fund && all(["PENDING"]) && data.permissions.approveFund && (
          <>
            {btn("APPROVE_FUNDS", "通过资金审批", true)}
            {btn("RETURN_FUNDS", "退回资金申请")}
          </>
        )}
        {fund &&
          all(["APPROVED", "PARTIAL"]) &&
          rows.length === 1 &&
          data.permissions.finance &&
          btn("PAY", "登记实际付款", true)}
        {fund &&
          all(["PENDING", "APPROVED"]) &&
          rows.every((r) => !r.paidCents) &&
          btn("WITHDRAW_FUND", "撤回资金单")}
        {fund &&
          all(["PENDING", "APPROVED", "PARTIAL"]) &&
          data.permissions.finance &&
          btn("CLOSE_FUND", "关闭未付余额")}
        {stock && (
          <>
            {(rows[0].onHand || 0) > 0 && btn("ISSUE", "领用出库", true)}
            {(rows[0].issued || 0) > 0 && btn("RESTOCK", "领用退库")}
            {data.permissions.buy && btn("ADJUST_STOCK", "库存调整")}
          </>
        )}
        {!compact && line && rows.length === 1 && (
          <>
            {btn("NOTE", "备注")}
            {btn("ATTACH_FILES", "补充附件")}
            {btn("VOID_LINES", "作废")}
          </>
        )}
      </div>
    );
  };
  const line = detail?.kind === "line" ? detail.record : null,
    fund = detail?.kind === "fund" ? detail.record : null;
  const formAction = dialog?.action || "",
    requestForm = ["SAVE_REQUEST", "EDIT_REQUEST"].includes(formAction),
    moneyForm = [
      "CREATE_FUND",
      "PAY",
      "OFFLINE_PAYMENT",
      "REFUND",
      "REFUND_HANDOVER",
      "INVOICE",
      "RETURN_GOODS",
    ].includes(formAction);
  const filesEnabled = [
    "SAVE_REQUEST",
    "EDIT_REQUEST",
    "PURCHASE",
    "CREATE_FUND",
    "PAY",
    "OFFLINE_PAYMENT",
    "REFUND",
    "REFUND_HANDOVER",
    "INVOICE",
    "CONTRACT",
    "ATTACH_FILES",
  ].includes(formAction);
  return (
    <main className="pc-shell hm-workbench-root hm-workbench-navigation-overlay">
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/purchases"
        subtitle="采购管理"
        menuItems={[]}
        hideHeader
        sidebarTriggerTargetId="pc-nav-trigger"
      />
      <header className="pc-top">
        <div>
          <div className="pc-eyebrow">鸿蒙 · 采购与物资</div>
          <h1>
            <span id="pc-nav-trigger" />
            采购工作台 <span>采购闭环管理</span>
          </h1>
        </div>
        <div className="pc-actions">
          <button
            onClick={() => setRevision((n) => n + 1)}
            aria-label="刷新采购"
          >
            <RefreshCw size={16} />
          </button>
          {data.permissions.configure && (
            <button onClick={() => void open("SAVE_SETTINGS")}>
              <Settings size={15} />
              流程设置
            </button>
          )}
          <button
            className="pc-primary"
            onClick={() => void open("SAVE_REQUEST")}
          >
            <Plus size={17} />
            发起采购
          </button>
        </div>
      </header>
      {!data.settings && (
        <div className="pc-banner">
          首次使用，请配置采购审批、采购经办、资金审批和财务确认人。配置完成即可提交申请。
          {data.permissions.configure && (
            <button onClick={() => void open("SAVE_SETTINGS")}>现在配置</button>
          )}
        </div>
      )}
      {error && (
        <div className="pc-error" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="关闭错误">
            <X size={15} />
          </button>
        </div>
      )}
      {message && (
        <div className="pc-success" role="status">
          <Check size={17} />
          {message}
          <button onClick={() => setMessage("")} aria-label="关闭提示">
            <X size={15} />
          </button>
        </div>
      )}
      <div className="pc-layout">
        <aside className="pc-menu">
          <div className="pc-menu-label">工作队列</div>
          {PC_VIEWS.map((v) => (
            <button
              key={v.id}
              className={view === v.id ? "active" : ""}
              onClick={() => {
                setView(v.id);
                setPage(1);
                setSelected([]);
                setActiveId("");
                setFilters((f) => ({ ...f, follow: "" }));
              }}
            >
              <span>{v.label}</span>
              <b>{data.counts[v.id] || 0}</b>
            </button>
          ))}
          <div className="pc-menu-note">
            <Package size={22} />
            <b>每一笔采购，都有来处</b>
            <span>
              申请、付款、入库与票据
              <br />
              在一条记录中追溯
            </span>
          </div>
        </aside>
        <section className="pc-main">
          <div className="pc-section-title">
            <div>
              <h2>{PC_VIEWS.find((v) => v.id === view)?.label}</h2>
              <p>
                {view === "stock"
                  ? "按物资、来源采购和库位追溯库存"
                  : view === "finance"
                    ? "批准后登记实际付款，支持分次打款"
                    : view === "documents"
                      ? "跟进发票覆盖、红冲与退款归还"
                      : "按当前环节处理，展开记录查看完整来龙去脉"}
              </p>
            </div>
            <div className="pc-total">
              <span>
                {data.total} {view === "stock" ? "条库存" : "条记录"}
              </span>
              {view !== "stock" && <strong>{pcMoney(data.totalCents)}</strong>}
            </div>
          </div>
          <div className="pc-filters">
            <label className="pc-search">
              <Search size={17} />
              <input
                placeholder="搜索物品、编号、申请人或供应商"
                aria-label="搜索采购"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            {view !== "stock" && (
              <>
                <select
                  aria-label="结算方式筛选"
                  value={filters.settlement}
                  onChange={(e) => changeFilter("settlement", e.target.value)}
                >
                  <option value="">全部结算</option>
                  {Object.entries(PC_SETTLEMENTS).map(([k, v]) => (
                    <option value={k} key={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="供应商筛选"
                  value={filters.supplierId}
                  onChange={(e) => changeFilter("supplierId", e.target.value)}
                >
                  <option value="">全部供应商</option>
                  {data.suppliers.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="跟进条件"
                  value={filters.follow}
                  onChange={(e) => changeFilter("follow", e.target.value)}
                >
                  <option value="">全部跟进事项</option>
                  {["funds", "finance"].includes(view) ? (
                    <option value="history">包括已结束资金单</option>
                  ) : (
                    <>
                      <option value="unpaid">待付款</option>
                      <option value="invoice">待补票 / 红冲</option>
                      <option value="refund">待退款归还</option>
                      {view === "all" && (
                        <option value="void">已作废记录</option>
                      )}
                    </>
                  )}
                </select>
              </>
            )}
          </div>
          <div className="pc-filter-secondary">
            {view !== "stock" && (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={filters.mine === "1"}
                    onChange={(e) =>
                      changeFilter("mine", e.target.checked ? "1" : "")
                    }
                  />
                  我经手的未结事项
                </label>
                <input
                  type="date"
                  aria-label="开始日期"
                  value={filters.from}
                  onChange={(e) => changeFilter("from", e.target.value)}
                />
                <span>至</span>
                <input
                  type="date"
                  aria-label="结束日期"
                  value={filters.to}
                  onChange={(e) => changeFilter("to", e.target.value)}
                />
                <select
                  aria-label="紧急程度筛选"
                  value={filters.urgency}
                  onChange={(e) => changeFilter("urgency", e.target.value)}
                >
                  <option value="">全部紧急程度</option>
                  <option value="URGENT">加急</option>
                  <option value="CRITICAL">紧急</option>
                  <option value="NORMAL">普通</option>
                </select>
              </>
            )}
            <button className="pc-export" onClick={() => void exportRows()}>
              <ArrowDownToLine size={15} />
              {selected.length ? "导出选中" : "导出筛选结果"}
            </button>
          </div>
          {selected.length > 0 && (
            <div className="pc-selection">
              <span>
                已选 {selected.length} 项 ·{" "}
                {pcMoney(sum(selectedRows, "amountCents"))}
              </span>
              {actions(selectedRows, true)}
              <button onClick={() => setSelected([])}>取消选择</button>
            </div>
          )}
          <div className="pc-table-wrap" aria-busy={loading}>
            <table className="pc-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="选择当前页全部记录"
                      checked={
                        !!data.rows.length &&
                        data.rows.every((r) => selected.includes(r.id))
                      }
                      onChange={(e) =>
                        setSelected(
                          e.target.checked ? data.rows.map((r) => r.id) : [],
                        )
                      }
                    />
                  </th>
                  <th>{view === "stock" ? "物资 / 来源" : "物品 / 单号"}</th>
                  <th>
                    {["finance", "funds"].includes(view)
                      ? "申请人与收款账户"
                      : "申请人 / 供应商"}
                  </th>
                  <th>{view === "stock" ? "库存 / 已领用" : "金额 / 结算"}</th>
                  <th>{view === "stock" ? "仓库 / 库位" : "当前进展"}</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr
                    key={r.id}
                    className={activeId === r.id ? "pc-row-active" : ""}
                    onClick={() => openDetail(r.id)}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={"选择 " + r.number}
                        checked={selected.includes(r.id)}
                        onChange={(e) =>
                          setSelected((p) =>
                            e.target.checked
                              ? [...p, r.id]
                              : p.filter((id) => id !== r.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      <button
                        className="pc-record-link"
                        onClick={() => openDetail(r.id)}
                      >
                        {r.name || "未命名草稿"}
                      </button>
                      <small>
                        {r.spec || "未填规格"}
                        {r.kind === "line" ? ` · ${r.quantity} ${r.unit}` : ""}
                      </small>
                      <span className="pc-number">{r.number}</span>
                    </td>
                    <td>
                      <b>{r.applicantName}</b>
                      <small>
                        {r.kind === "fund"
                          ? r.account
                          : r.supplier || "待确认供应商"}
                      </small>
                      {r.urgency !== "NORMAL" && (
                        <em className="pc-urgent">
                          {r.urgency === "CRITICAL" ? "紧急" : "加急"}
                        </em>
                      )}
                    </td>
                    <td>
                      {r.kind === "stock" ? (
                        <>
                          <strong>
                            {r.onHand} {r.unit}
                          </strong>
                          <small>
                            领用 {r.issued} {r.unit}
                          </small>
                        </>
                      ) : (
                        <>
                          <strong>{pcMoney(r.amountCents)}</strong>
                          <small>
                            {r.status === "ORDERED" || r.kind === "fund"
                              ? PC_SETTLEMENTS[r.settlement]
                              : "预算合计"}
                          </small>
                        </>
                      )}
                    </td>
                    <td>
                      {r.kind === "stock" ? (
                        <>
                          <b>{r.warehouse}</b>
                          <small>{r.location}</small>
                        </>
                      ) : (
                        <>
                          <span
                            className={
                              "pc-badge " +
                              (r.completed ? "done" : r.status.toLowerCase())
                            }
                          >
                            {r.completed
                              ? "已完成"
                              : r.kind === "fund" && r.status === "APPROVED"
                                ? "待打款"
                                : PC_STATES[r.status]}
                          </span>
                          {r.status === "ORDERED" ? (
                            <small>
                              已收 {r.receivedQty}/{r.quantity - r.cancelledQty}{" "}
                              · 已付 {pcMoney(r.paidCents)}
                            </small>
                          ) : (
                            <small>
                              {r.needDate ? `需求 ${r.needDate}` : ""}
                            </small>
                          )}
                          {r.refundOpen > 0 && (
                            <small className="pc-warning">
                              待归还 {pcMoney(r.refundOpen)}
                            </small>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      <button
                        className="pc-text-btn"
                        onClick={() => openDetail(r.id)}
                      >
                        查看 →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.rows.length && (
              <div className="pc-empty">
                <ClipboardList size={34} />
                <h3>{loading ? "正在加载采购记录" : "当前队列暂无记录"}</h3>
                <p>
                  {view === "all"
                    ? "从发起采购开始，审批、采购和收货进展会显示在这里。"
                    : "更换筛选条件，或到全部采购查看其他环节。"}
                </p>
                {view === "all" && (
                  <button
                    className="pc-primary"
                    onClick={() => void open("SAVE_REQUEST")}
                  >
                    发起第一笔采购
                  </button>
                )}
              </div>
            )}
          </div>
          <footer className="pc-pagination">
            <span>
              共 {data.total} 条 · 每页 {data.pageSize} 条
              {loading ? " · 更新中" : ""}
            </span>
            <div>
              <button
                aria-label="上一页"
                disabled={page <= 1 || loading}
                onClick={() => {
                  setPage((p) => p - 1);
                  setSelected([]);
                }}
              >
                <ChevronLeft size={17} />
              </button>
              <span>
                {page} / {Math.max(1, Math.ceil(data.total / data.pageSize))}
              </span>
              <button
                aria-label="下一页"
                disabled={page * data.pageSize >= data.total || loading}
                onClick={() => {
                  setPage((p) => p + 1);
                  setSelected([]);
                }}
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </footer>
        </section>
      </div>
      {activeId && (
        <aside className="pc-detail" aria-label="采购记录详情">
          <header>
            <div>
              <small>完整业务记录</small>
              <h2>{line?.name || fund?.number || "采购详情"}</h2>
            </div>
            <button aria-label="关闭详情" onClick={() => setActiveId("")}>
              <X size={20} />
            </button>
          </header>
          {!detail ? (
            <div className="pc-empty">正在加载…</div>
          ) : (
            <>
              <nav className="pc-detail-tabs">
                {[
                  ["overview", "业务详情"],
                  ["files", "附件凭证"],
                  ["history", "操作记录"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    className={detailTab === id ? "active" : ""}
                    onClick={() => setDetailTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              <div className="pc-detail-body">
                {detailTab === "overview" && line && (
                  <>
                    <div className="pc-detail-amount">
                      <span>当前应付</span>
                      <strong>
                        {pcMoney(
                          line.status === "ORDERED"
                            ? line.payableCents
                            : line.estimateCents,
                        )}
                      </strong>
                      <span className="pc-badge">
                        {line.completedAt ? "已完成" : PC_STATES[line.status]}
                      </span>
                    </div>
                    <Facts>
                      <Fact label="采购编号">{line.number}</Fact>
                      <Fact label="申请 / 提交">
                        {line.request.applicantName} /{" "}
                        {line.request.submitterName}
                      </Fact>
                      <Fact label="物品规格">
                        {line.spec} · {line.quantity} {line.unit}
                      </Fact>
                      <Fact label="需求日期">{line.needDate}</Fact>
                      <Fact label="采购用途">{line.request.purpose}</Fact>
                      <Fact label="关联工单">{line.request.workOrderCode}</Fact>
                      <Fact label="供应商">{line.supplier?.name}</Fact>
                      <Fact label="结算方式">
                        {PC_SETTLEMENTS[line.settlement]}
                      </Fact>
                      <Fact label="收款人">{line.payee}</Fact>
                      <Fact label="银行 / 账户">
                        {line.bank} {line.account}
                      </Fact>
                      <Fact label="采购经办">{line.buyerName}</Fact>
                      <Fact label="预计到货">{line.eta}</Fact>
                      {line.settlement === "MONTHLY" && (
                        <Fact label="月结账期">
                          {line.cycle} · {line.dueDate} 到期
                        </Fact>
                      )}
                      <Fact label="备注">{line.note || line.reason}</Fact>
                    </Facts>
                    {line.referenceUrl && (
                      <a
                        href={line.referenceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="pc-text-btn"
                      >
                        查看采购参考链接 ↗
                      </a>
                    )}
                    {line.status === "ORDERED" && (
                      <div className="pc-metrics">
                        <div>
                          <small>已收 / 待收</small>
                          <b>
                            {line.receivedQty} /{" "}
                            {line.quantity -
                              line.receivedQty -
                              line.cancelledQty}
                          </b>
                        </div>
                        <div>
                          <small>实际净付款</small>
                          <b>{pcMoney(line.paidCents - line.refundedCents)}</b>
                        </div>
                        <div>
                          <small>已关联发票</small>
                          <b>{pcMoney(line.invoiceCents)}</b>
                        </div>
                      </div>
                    )}
                    <h3>
                      关联资金单 <span>{line.allocations.length}</span>
                    </h3>
                    {!line.allocations.length && (
                      <p className="pc-muted">
                        尚未申请资金；登记采购后可单独发起。
                      </p>
                    )}
                    {line.allocations.map((al) => (
                      <button
                        className="pc-related"
                        key={al.id}
                        onClick={() => openDetail(al.fundId)}
                      >
                        <b>
                          {al.fund.number}{" "}
                          <span>{PC_STATES[al.fund.status]}</span>
                        </b>
                        <small>
                          分摊 {pcMoney(al.amountCents)} · 已付{" "}
                          {pcMoney(al.paidCents)} ·{" "}
                          {al.active ? "有效" : "已释放"}
                        </small>
                      </button>
                    ))}
                    <h3>收货与库存</h3>
                    {line.receipts.map((r) => (
                      <div className="pc-log" key={r.id}>
                        <b>
                          {r.date} · {r.quantity} {line.unit}
                        </b>
                        <small>
                          {r.number} · 收货人 {r.receiver}
                        </small>
                      </div>
                    ))}
                    {line.balances.map((b) => (
                      <div className="pc-log" key={b.id}>
                        <b>
                          {b.warehouse} / {b.location} · 在库 {b.onHand}
                        </b>
                        <small>
                          {line.item?.number} · 已领用 {b.issued}
                        </small>
                        <div className="pc-actions">
                          <button
                            onClick={() =>
                              void open("ISSUE", [
                                {
                                  ...rowFromLine(line),
                                  id: b.id,
                                  kind: "stock",
                                  version: b.version,
                                  onHand: b.onHand,
                                  issued: b.issued,
                                },
                              ])
                            }
                          >
                            领用
                          </button>
                          <button
                            onClick={() =>
                              void open("RESTOCK", [
                                {
                                  ...rowFromLine(line),
                                  id: b.id,
                                  kind: "stock",
                                  version: b.version,
                                  onHand: b.onHand,
                                  issued: b.issued,
                                },
                              ])
                            }
                          >
                            退库
                          </button>
                        </div>
                        <details>
                          <summary>查看库存流水</summary>
                          {b.movements.map((m) => (
                            <p key={m.id}>
                              {time(m.createdAt)} ·{" "}
                              {eventNames[m.kind] || m.kind}{" "}
                              {m.quantity > 0 ? "+" : ""}
                              {m.quantity} · 结存 {m.balance}
                              <small>
                                {m.person} {m.reason} · {m.actorName}
                              </small>
                            </p>
                          ))}
                        </details>
                      </div>
                    ))}
                    <h3>退货与退款</h3>
                    {line.returns.length === 0 && (
                      <p className="pc-muted">暂无退货记录</p>
                    )}
                    {line.returns.map((r) => (
                      <div className="pc-log" key={r.id}>
                        <b>
                          {r.number} · {r.quantity} {line.unit}
                        </b>
                        <small>
                          {r.kind === "STOCK" ? "在库退货" : "未入库退货"} ·
                          冲减 {pcMoney(r.amountCents)} · {r.reason}
                        </small>
                        <p>
                          应退 {pcMoney(r.refundDueCents)} / 公司到账{" "}
                          {pcMoney(r.companyReceivedCents)}
                        </p>
                        {r.refundedCents > r.companyReceivedCents && (
                          <p className="pc-warning">
                            个人已收待归还{" "}
                            {pcMoney(r.refundedCents - r.companyReceivedCents)}
                          </p>
                        )}
                        {data.permissions.finance && (
                          <div className="pc-actions">
                            {r.refundDueCents > r.refundedCents && (
                              <button
                                onClick={() =>
                                  void open("REFUND", [rowFromLine(line)], {
                                    returnId: r.id,
                                  })
                                }
                              >
                                确认退款到账
                              </button>
                            )}
                            {r.refundedCents > r.companyReceivedCents && (
                              <button
                                onClick={() =>
                                  void open(
                                    "REFUND_HANDOVER",
                                    [rowFromLine(line)],
                                    { returnId: r.id },
                                  )
                                }
                              >
                                确认归还公司
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    <h3>合同与发票</h3>
                    {line.contractLines.map((c) => (
                      <a
                        key={c.id}
                        className="pc-related"
                        href={"/workspace/purchases/contracts/" + c.contractId}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <b>
                          {c.contract.number} · 第 {c.contract.revision} 版 ↗
                        </b>
                        <small>打开、打印或下载 PDF</small>
                      </a>
                    ))}
                    {line.invoiceLines.map((i) => (
                      <div key={i.id} className="pc-log">
                        <b>
                          {i.invoice.number} ·{" "}
                          {i.invoice.kind === "CREDIT" ? "红冲" : "发票"}
                        </b>
                        <small>
                          本项关联 {pcMoney(i.amountCents)} · {i.invoice.date}
                        </small>
                      </div>
                    ))}
                    {line.request.lines.length > 1 && (
                      <>
                        <h3>同一申请的其他物品</h3>
                        {line.request.lines
                          .filter((l) => l.id !== line.id)
                          .map((l) => (
                            <button
                              className="pc-related"
                              key={l.id}
                              onClick={() => openDetail(l.id)}
                            >
                              {l.name} · {PC_STATES[l.status]}
                            </button>
                          ))}
                      </>
                    )}
                  </>
                )}
                {detailTab === "overview" && fund && (
                  <>
                    <div className="pc-detail-amount">
                      <span>本单申请</span>
                      <strong>{pcMoney(fund.amountCents)}</strong>
                      <span className="pc-badge">
                        {fund.status === "APPROVED"
                          ? "待打款"
                          : PC_STATES[fund.status]}
                      </span>
                    </div>
                    {fund.accountChanged && (
                      <div className="pc-banner">
                        本次收款信息与采购登记不同，请核对变更原因。
                      </div>
                    )}
                    <Facts>
                      <Fact label="收款人">{fund.payee}</Fact>
                      <Fact label="开户银行">{fund.bank}</Fact>
                      <Fact label="收款账户">{fund.account}</Fact>
                      <Fact label="结算方式">
                        {PC_SETTLEMENTS[fund.settlement]}
                      </Fact>
                      <Fact label="申请人">{fund.actorName}</Fact>
                      <Fact label="申请前明细余额">
                        {pcMoney(fund.originalCents)}
                      </Fact>
                      <Fact label="已付款 / 待付款">
                        {pcMoney(fund.paidCents)} /{" "}
                        {pcMoney(fund.amountCents - fund.paidCents)}
                      </Fact>
                      <Fact label="差额 / 处理说明">{fund.reason}</Fact>
                    </Facts>
                    <h3>关联采购与分摊</h3>
                    {fund.allocations.map((al) => (
                      <button
                        key={al.id}
                        className="pc-related"
                        onClick={() => openDetail(al.lineId)}
                      >
                        <b>
                          {al.line.name} · {pcMoney(al.amountCents)}
                        </b>
                        <small>
                          {al.line.number} · 本单已付 {pcMoney(al.paidCents)}
                        </small>
                      </button>
                    ))}
                    <h3>实际付款记录</h3>
                    {!fund.payments.length && (
                      <p className="pc-muted">
                        尚未打款。审批通过后由财务登记实际流水。
                      </p>
                    )}
                    {fund.payments.map((p) => (
                      <div key={p.id} className="pc-log">
                        <b>
                          {pcMoney(p.amountCents)} · {p.date}
                        </b>
                        <small>
                          {p.source} · 流水 {p.reference}
                        </small>
                        <small>
                          {p.actorName} · {time(p.createdAt)}
                        </small>
                      </div>
                    ))}
                  </>
                )}
                {detailTab === "overview" && detail.kind === "request" && (
                  <>
                    {detail.record.lines.map((l) => (
                      <button
                        className="pc-related"
                        key={l.id}
                        onClick={() => openDetail(l.id)}
                      >
                        {l.name} · {PC_STATES[l.status]}
                      </button>
                    ))}
                  </>
                )}
                {detailTab === "files" && (
                  <>
                    {!detail.attachments.length && (
                      <div className="pc-empty">
                        暂无附件，可通过“补充附件”追加凭证。
                      </div>
                    )}
                    {detail.attachments.map((f) => (
                      <a
                        className="pc-related"
                        key={f.id}
                        href={"/api/purchases/attachments?id=" + f.id}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <b>{f.originalName} ↗</b>
                        <small>{Math.ceil(f.size / 1024)} KB · 点击查看</small>
                      </a>
                    ))}
                  </>
                )}
                {detailTab === "history" &&
                  detail.events.map((e) => (
                    <div className="pc-timeline" key={e.id}>
                      <b>
                        {eventNames[e.action] || titles[e.action] || e.action}
                      </b>
                      <small>
                        {e.actorName} · {time(e.createdAt)}
                      </small>
                      {e.reason && <p>{e.reason}</p>}
                      <details>
                        <summary>查看当时的数据</summary>
                        <pre>{JSON.stringify(e.snapshot, null, 2)}</pre>
                      </details>
                    </div>
                  ))}
              </div>
              <footer>
                {line && actions([rowFromLine(line)])}
                {fund &&
                  actions([
                    {
                      id: fund.id,
                      version: fund.version,
                      kind: "fund",
                      status: fund.status,
                      paidCents: fund.paidCents,
                    } as PcRow,
                  ])}
              </footer>
            </>
          )}
        </aside>
      )}
      {dialog && (
        <div className="pc-overlay">
          <div
            className={"pc-dialog " + (requestForm ? "pc-dialog-wide" : "")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pc-dialog-title"
            ref={formRef}
          >
            <header>
              <div>
                <small>
                  {dialog.rows.length
                    ? `${dialog.rows.length} 项记录 · 确认后保存业务记录`
                    : "采购工作台"}
                </small>
                <h2 id="pc-dialog-title">{titles[formAction]}</h2>
              </div>
              <button
                aria-label="关闭操作窗口"
                disabled={busy || uploading}
                onClick={() => setDialog(null)}
              >
                <X size={21} />
              </button>
            </header>
            <div className="pc-dialog-body">
              {formError && (
                <div className="pc-error" role="alert">
                  {formError}
                </div>
              )}
              {requestForm && (
                <>
                  <div className="pc-form-grid">
                    <Field label="申请人">{userSelect("applicantId")}</Field>
                    <Field label="关联工单（选填）">
                      {select("workOrderId", {
                        "": "不关联工单",
                        ...Object.fromEntries(
                          workorders.map((w) => [w.id, w.code]),
                        ),
                      })}
                    </Field>
                    <Field label="采购用途" wide>
                      <textarea
                        value={form.purpose || ""}
                        onChange={(e) => set("purpose", e.target.value)}
                        placeholder="写明使用场景、所需数量和原因"
                      />
                    </Field>
                  </div>
                  <div className="pc-request-lines">
                    {requestLines.map((l, i) => (
                      <section className="pc-request-item" key={l.id || i}>
                        <header>
                          <b>
                            物品 {i + 1}
                            {l.id ? " · 修改明细" : ""}
                          </b>
                          {requestLines.length > 1 &&
                            (!l.id || dialog.requestDraft) && (
                              <button
                                onClick={() =>
                                  setRequestLines((ls) =>
                                    ls.filter((_, j) => i !== j),
                                  )
                                }
                              >
                                移除
                              </button>
                            )}
                        </header>
                        <div className="pc-form-grid">
                          {(
                            [
                              "name",
                              "spec",
                              "quantity",
                              "unit",
                              "amount",
                              "needDate",
                            ] as const
                          ).map((key) => (
                            <Field
                              label={
                                {
                                  name: "物品名称",
                                  spec: "规格型号",
                                  quantity: "数量",
                                  unit: "单位",
                                  amount: "预算总额（元）",
                                  needDate: "需求日期",
                                }[key]
                              }
                              key={key}
                            >
                              <input
                                type={
                                  key === "needDate"
                                    ? "date"
                                    : key === "quantity" || key === "amount"
                                      ? "number"
                                      : "text"
                                }
                                value={l[key]}
                                min={key === "quantity" ? 1 : 0}
                                step={key === "quantity" ? 1 : "0.01"}
                                onChange={(e) =>
                                  setRequestLines((ls) =>
                                    ls.map((x, j) =>
                                      i === j
                                        ? { ...x, [key]: e.target.value }
                                        : x,
                                    ),
                                  )
                                }
                              />
                            </Field>
                          ))}
                          <Field label="物品类型">
                            <select
                              value={l.category}
                              onChange={(e) =>
                                setRequestLines((ls) =>
                                  ls.map((x, j) =>
                                    i === j
                                      ? { ...x, category: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                            >
                              {[
                                "生产工具",
                                "治具配件",
                                "办公用品",
                                "劳保用品",
                                "耗材",
                                "设备",
                                "其他",
                              ].map((c) => (
                                <option key={c}>{c}</option>
                              ))}
                            </select>
                          </Field>
                          <Field label="紧急程度">
                            <select
                              value={l.urgency}
                              onChange={(e) =>
                                setRequestLines((ls) =>
                                  ls.map((x, j) =>
                                    i === j
                                      ? { ...x, urgency: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                            >
                              <option value="NORMAL">普通</option>
                              <option value="URGENT">加急</option>
                              <option value="CRITICAL">紧急</option>
                            </select>
                          </Field>
                          <Field label="采购参考链接（选填）" wide>
                            <input
                              type="url"
                              value={l.referenceUrl}
                              onChange={(e) =>
                                setRequestLines((ls) =>
                                  ls.map((x, j) =>
                                    i === j
                                      ? { ...x, referenceUrl: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                              placeholder="https://"
                            />
                          </Field>
                        </div>
                      </section>
                    ))}
                  </div>
                  <button
                    className="pc-add-line"
                    onClick={() =>
                      setRequestLines((ls) => [...ls, blankLine()])
                    }
                  >
                    <Plus size={16} />
                    添加物品
                  </button>
                  <p className="pc-muted">
                    预算填写每项总额。已审批的其他明细保持原记录，退回项可单独修改后提交。
                  </p>
                </>
              )}
              {formAction === "SAVE_SETTINGS" && (
                <>
                  <p className="pc-muted">
                    所有已登录用户共享采购数据。以下为流程中实际办理人的分工，每个环节可选择多人。
                  </p>
                  <div className="pc-form-grid">
                    <Field label="配置维护人">{userSelect("ownerId")}</Field>
                    {Object.entries({
                      purchaseApproverIds: "采购审批负责人",
                      buyerIds: "采购经办人",
                      fundApproverIds: "资金审批负责人",
                      financeIds: "财务确认人",
                    }).map(([key, label]) => (
                      <fieldset className="pc-persons" key={key}>
                        <legend>{label}</legend>
                        {data.users.map((u) => (
                          <label key={u.id}>
                            <input
                              type="checkbox"
                              checked={
                                assignments[key]?.includes(u.id) || false
                              }
                              onChange={(e) =>
                                setAssignments((s) => ({
                                  ...s,
                                  [key]: e.target.checked
                                    ? [...(s[key] || []), u.id]
                                    : (s[key] || []).filter(
                                        (id) => id !== u.id,
                                      ),
                                }))
                              }
                            />
                            {u.name}
                          </label>
                        ))}
                      </fieldset>
                    ))}
                  </div>
                </>
              )}
              {!requestForm &&
                formAction !== "SAVE_SETTINGS" &&
                dialog.rows.length > 0 && (
                  <div className="pc-dialog-summary">
                    {dialog.rows.map((r) => (
                      <div key={r.id}>
                        <b>{r.name || r.number}</b>
                        <span>{r.number}</span>
                        <strong>
                          {r.kind !== "stock" && pcMoney(r.amountCents || 0)}
                        </strong>
                      </div>
                    ))}
                  </div>
                )}
              <div className="pc-form-grid">
                {formAction === "PURCHASE" && (
                  <>
                    <Field label="供应商">
                      {input("supplier", "text", "供应商全称")}
                    </Field>
                    <Field label="结算方式">
                      {select("settlement", PC_SETTLEMENTS)}
                    </Field>
                    <Field label="采购经办人">{userSelect("buyerId")}</Field>
                    <Field label="预计到货日期">{input("eta", "date")}</Field>
                    {form.settlement === "ADVANCE" && (
                      <Field label="实际垫付人">
                        {userSelect("payeeUserId")}
                      </Field>
                    )}
                    {form.settlement === "MONTHLY" && (
                      <>
                        <Field label="月结账期">
                          {input("cycle", "month")}
                        </Field>
                        <Field label="付款到期日期">
                          {input("dueDate", "date")}
                        </Field>
                      </>
                    )}
                    {dialog.lines.map((l) => (
                      <div className="pc-wide pc-purchase-line" key={l.id}>
                        <Field label={l.name + " · 实际采购总额（元）"}>
                          {input("actual:" + l.id, "number")}
                        </Field>
                        <Field label="物资身份">
                          {select("item:" + l.id, {
                            "": "新建独立物资编号",
                            ...Object.fromEntries(
                              itemOptions
                                .filter(
                                  (m) => m.unit === l.unit && m.spec === l.spec,
                                )
                                .map((m) => [m.id, `${m.number} · ${m.name}`]),
                            ),
                            ...(l.item
                              ? {
                                  [l.item.id]:
                                    `${l.item.number} · ${l.item.name}`,
                                }
                              : {}),
                          })}
                        </Field>
                      </div>
                    ))}
                    <Field label="合同编号（单项总额 ≥ 500 元必填）" wide>
                      {input(
                        "contractNumber",
                        "text",
                        "填写编号可同时生成合同快照",
                      )}
                    </Field>
                  </>
                )}
                {["PURCHASE", "CREATE_FUND"].includes(formAction) && (
                  <>
                    <Field label="收款人 / 单位">{input("payee")}</Field>
                    <Field label="开户银行">{input("bank")}</Field>
                    <Field label="收款账号" wide>
                      {input("account")}
                    </Field>
                    {formAction === "PURCHASE" && (
                      <button
                        className="pc-wide"
                        onClick={() => void loadAccountHistory()}
                      >
                        读取该供应商 / 垫付人的最近账户
                      </button>
                    )}
                  </>
                )}
                {["CREATE_FUND", "OFFLINE_PAYMENT"].includes(formAction) && (
                  <>
                    <Field label="差额类型">
                      {select("adjustment", {
                        NONE: "与明细余额一致",
                        PARTIAL: "本次仅申请部分",
                        DISCOUNT: "议价 / 优惠冲减",
                        FREIGHT: "增加运费",
                        ROUNDING: "舍入调整（最多 1 元）",
                      })}
                    </Field>
                    <Field label="期望付款日期（选填）">
                      {input("dueDate", "date")}
                    </Field>
                    <div className="pc-banner pc-wide">
                      可申请余额 {pcMoney(sum(dialog.rows, "availableCents"))}
                      。部分请款保留后续余额；优惠、运费或舍入会同步调整采购应付。
                    </div>
                  </>
                )}
                {moneyForm && (
                  <Field
                    label={
                      formAction === "INVOICE"
                        ? "本次关联票面金额（元）"
                        : formAction === "RETURN_GOODS"
                          ? "退货冲减金额（元）"
                          : "本次金额（元）"
                    }
                  >
                    {input("amount", "number")}
                  </Field>
                )}
                {[
                  "PAY",
                  "OFFLINE_PAYMENT",
                  "RECEIVE",
                  "RETURN_GOODS",
                  "REFUND",
                  "REFUND_HANDOVER",
                  "INVOICE",
                ].includes(formAction) && (
                  <Field
                    label={
                      formAction === "INVOICE" ? "开票日期" : "实际发生日期"
                    }
                  >
                    {input("date", "date")}
                  </Field>
                )}
                {["PAY", "OFFLINE_PAYMENT"].includes(formAction) && (
                  <>
                    <Field label="公司付款账户">{input("source")}</Field>
                    <Field label="银行流水号">{input("reference")}</Field>
                  </>
                )}
                {["REFUND", "REFUND_HANDOVER"].includes(formAction) && (
                  <>
                    <Field label="到账凭证 / 流水号">
                      {input("reference")}
                    </Field>
                    {formAction === "REFUND" && (
                      <Field label="实际到账对象">
                        {select("destination", {
                          COMPANY: "公司账户已收到",
                          PERSON: "个人已收到，待归还公司",
                        })}
                      </Field>
                    )}
                  </>
                )}
                {formAction === "RECEIVE" && (
                  <>
                    <Field label="收货人">{userSelect("receiverId")}</Field>
                    <Field label="仓库">{input("warehouse")}</Field>
                    <Field label="库位">{input("location")}</Field>
                    {dialog.lines.map((l) => (
                      <Field
                        key={l.id}
                        label={`${l.name} · 本次收货（最多 ${l.quantity - l.receivedQty - l.cancelledQty} ${l.unit}）`}
                      >
                        {input("quantity:" + l.id, "number")}
                      </Field>
                    ))}
                  </>
                )}
                {formAction === "RETURN_GOODS" && (
                  <>
                    <Field label="退货类型">
                      {select("kind", {
                        STOCK: "已入库 · 从库存退货",
                        UNRECEIVED: "未入库 · 取消未到货物品",
                      })}
                    </Field>
                    {form.kind === "STOCK" && (
                      <Field label="退货库位">
                        {select("stockId", {
                          "": "选择可退库存",
                          ...Object.fromEntries(
                            (dialog.lines[0]?.balances || []).map((b) => [
                              b.id,
                              `${b.warehouse}/${b.location} · 在库 ${b.onHand}`,
                            ]),
                          ),
                        })}
                      </Field>
                    )}
                    <Field label="退货数量">
                      {input("quantity", "number")}
                    </Field>
                    <div className="pc-banner pc-wide">
                      关联资金单仍在审批或尚有未付款余额时，需先在详情中撤回资金单或由财务关闭未付余额。已领用物品先退库。
                    </div>
                  </>
                )}
                {["ISSUE", "RESTOCK", "ADJUST_STOCK"].includes(formAction) && (
                  <>
                    <Field label="本次数量">
                      {input("quantity", "number")}
                    </Field>
                    {formAction === "ADJUST_STOCK" ? (
                      <Field label="调整方向">
                        {select("direction", {
                          OUT: "盘亏减少",
                          IN: "盘盈增加",
                        })}
                      </Field>
                    ) : (
                      <Field label="领用 / 归还人">{input("person")}</Field>
                    )}
                    <div className="pc-banner pc-wide">
                      当前在库 {dialog.rows[0]?.onHand || 0}，尚未归还的领用数量{" "}
                      {dialog.rows[0]?.issued || 0}。
                    </div>
                  </>
                )}
                {formAction === "INVOICE" && (
                  <>
                    <Field label="发票号码">{input("number")}</Field>
                    <Field label="票据类型">
                      {select("kind", {
                        NORMAL: "正常发票",
                        CREDIT: "红字冲减",
                      })}
                    </Field>
                    <p className="pc-muted pc-wide">
                      金额填写本次关联到选中采购的正数金额；红冲自动冲减。必须上传发票附件。
                    </p>
                  </>
                )}
                {formAction === "CONTRACT" && (
                  <>
                    <Field label="合同编号">{input("contractNumber")}</Field>
                    <Field label="供方">{input("supplier")}</Field>
                    <Field label="需方">{input("purchaser")}</Field>
                    <Field label="税率 / 含税口径">{input("taxNote")}</Field>
                    <Field label="交付、付款及其他约定" wide>
                      <textarea
                        value={form.terms || ""}
                        onChange={(e) => set("terms", e.target.value)}
                      />
                    </Field>
                    <p className="pc-muted pc-wide">
                      相同编号生成新版本并保留旧版。打印、下载不会提交审批或登记付款。
                    </p>
                  </>
                )}
                {formAction === "NOTE" ? (
                  <Field label="采购备注" wide>
                    <textarea
                      value={form.note || ""}
                      onChange={(e) => set("note", e.target.value)}
                    />
                  </Field>
                ) : (
                  !requestForm &&
                  ![
                    "APPROVE_LINES",
                    "APPROVE_FUNDS",
                    "PAY",
                    "RECEIVE",
                    "REFUND",
                    "REFUND_HANDOVER",
                    "INVOICE",
                    "CONTRACT",
                  ].includes(formAction) && (
                    <Field
                      label={
                        ["PURCHASE", "CREATE_FUND"].includes(formAction)
                          ? "变更 / 差额原因（发生变更时必填）"
                          : "操作原因 / 说明"
                      }
                      wide
                    >
                      <textarea
                        value={form.reason || ""}
                        onChange={(e) => set("reason", e.target.value)}
                        placeholder="说明这次操作的原因，记录将保留以便追溯"
                      />
                    </Field>
                  )
                )}
              </div>
              {filesEnabled && (
                <section className="pc-upload">
                  <b>附件凭证</b>
                  <label className="pc-upload-button">
                    {uploading ? "正在上传…" : "选择 PDF 或图片"}
                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.webp"
                      multiple
                      disabled={busy || uploading}
                      onChange={(e) => {
                        void upload(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <small>每份不超过 20 MB</small>
                  {files.map((f) => (
                    <div className="pc-file" key={f.id}>
                      <a
                        href={"/api/purchases/attachments?id=" + f.id}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {f.originalName}
                      </a>
                      <button
                        disabled={busy}
                        onClick={() =>
                          setFiles((fs) => fs.filter((x) => x.id !== f.id))
                        }
                      >
                        移除本次关联
                      </button>
                    </div>
                  ))}
                </section>
              )}
            </div>
            <footer>
              <span>
                {busy
                  ? "正在保存，请稍候"
                  : uploading
                    ? "附件上传中"
                    : "关闭窗口不会提交业务操作"}
              </span>
              <button
                disabled={busy || uploading}
                onClick={() => setDialog(null)}
              >
                取消
              </button>
              {requestForm && (
                <button
                  disabled={busy || uploading}
                  onClick={() => void submit(true)}
                >
                  保存草稿
                </button>
              )}
              <button
                className="pc-primary"
                disabled={busy || uploading}
                onClick={() => void submit()}
              >
                {busy
                  ? "保存中…"
                  : requestForm
                    ? "提交采购申请"
                    : "确认" + (formAction === "PAY" ? "登记付款" : "保存")}
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  );
}
