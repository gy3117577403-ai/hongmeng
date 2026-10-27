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
  Copy,
  Maximize2,
  Minimize2,
  Bell,
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
  PC_FUND_STATES,
  PC_EXECUTION_STAGES,
  pcCents,
  pcMoney,
  type PcInput,
  type PcRow,
  type PcWorkbench,
} from "@/lib/purchasing-domain";
import type { PcDetail } from "@/lib/purchasing-queries";
import type { CurrentUserDTO } from "@/types";

import {
  PurchaseToast,
  PurchaseActions,
  PurchaseConfirm,
} from "./PurchaseFeedback";
import PurchasePushPanel from "./PurchasePushPanel";
import { purchasingNextStep } from "@/lib/purchasing-presentation";
import { pcPurchasePricing } from "@/lib/purchasing-pricing";
import { PC_RECEIPT_STATES, pcReceiptState, pcSelectPage, pcFundingGroups, pcFundingIssue } from '@/lib/purchasing-selection';
import { pcReimbursementScope } from '@/lib/purchasing-reimbursement';
import { PC_UNITS, pcLegacyUnit, pcPaymentValue, pcQuantityText } from "@/lib/purchasing-fields";

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
  funds?: FundDetail[];
  requestId?: string;
  requestVersion?: number;
  requestDraft?: boolean;
  returnId?: string;
  returnVersion?: number;
  correctionId?: string;
  correctionVersion?: number;
};
function PurchaseQuantity({ quantity, unit }: { quantity: number; unit: string }) {
  return <span className="pc-quantity"><strong>{quantity > 0 ? pcQuantityText(quantity, unit) : '待填写'}</strong>{pcLegacyUnit(unit) && <small className="pc-warning">数量与单位待核对</small>}</span>;
}
const today = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
const blankLine = (): RequestLine => ({
  name: "",
  spec: "",
  unit: "件",
  quantity: "",
  amount: "",
  category: "生产工具",
  urgency: "NORMAL",
  needDate: today(),
  referenceUrl: "",
});
const titles: Record<string, string> = {
  SAVE_REQUEST: "发起请购",
  EDIT_REQUEST: "修改采购申请",
  SAVE_SETTINGS: "采购流程设置",
  APPROVE_LINES: "通过采购审批",
  RETURN_LINES: "退回采购申请",
  WITHDRAW_LINES: "撤回申请",
  VOID_LINES: "作废采购",
  PURCHASE: "登记采购信息",
  UPDATE_SETTLEMENT: "补充收款与结算资料",
  CORRECT_QUANTITY: "核对数量与单位",
  CORRECT_ADVANCE_AMOUNT: "更正垫付金额",
  APPROVE_AMOUNT_CORRECTION: "通过金额更正",
  REJECT_AMOUNT_CORRECTION: "退回金额更正",
  CREATE_FUND: "发起请款 / 报销",
  CREATE_REIMBURSEMENT: '快速申请报销',
  BATCH_CREATE_FUNDS: "分组申请请款 / 报销",
  APPROVE_FUNDS: "通过资金审批",
  RETURN_FUNDS: "退回资金申请",
  WITHDRAW_FUND: "撤回资金申请",
  CLOSE_FUND: "关闭未付款余额",
  PAY: "登记实际付款",
  BATCH_PAY: "批量登记打款",
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
  CORRECT_ADVANCE_AMOUNT: "申请垫付金额更正",
  APPLY_AMOUNT_CORRECTION: "垫付金额更正生效",
  APPROVE_AMOUNT_CORRECTION: "金额更正复核通过",
  REJECT_AMOUNT_CORRECTION: "金额更正复核退回",
  AMOUNT_CORRECTION_RELEASE: "金额更正释放未付余额",
  UPDATE_SETTLEMENT: "补充收款与结算资料",
  CORRECT_QUANTITY: "数量与单位更正",
  UNIT_CONVERSION: "计量换算",
  CREATE_FUND: "申请资金",
  OFFLINE_FUND: "补录付款申请",
  PAY: "登记付款",
  BATCH_PAY: "批量登记打款",
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
  const empty = (v: ReactNode): boolean =>
    v == null ||
    v === false ||
    (typeof v === "string" && !v.trim()) ||
    (Array.isArray(v) && v.every(empty));
  if (empty(children)) return null;
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
  initialCreate = false,
  initialTask = "",
  initialSource = "NORMAL",
  initialExecutionStage = "pending",
}: {
  user: CurrentUserDTO;
  initialData: PcWorkbench;
  initialView: string;
  initialRecord: string;
  initialCreate?: boolean;
  initialTask?: string;
  initialSource?: string;
  initialExecutionStage?: string;
}) {
  const [task, setTask] = useState(initialTask);
  const [confirmDiscard, setConfirmDiscard] = useState<"form" | "push" | null>(
    null,
  );
  const [expanded, setExpanded] = useState(false),
    [pushOpen, setPushOpen] = useState(false);
  const pushRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLElement>(null),
    detailTrigger = useRef<HTMLElement | null>(null),
    detailHistory = useRef<string[]>([]);
  const formDirty = useRef(false),
    pushDirty = useRef(false),
    createOpened = useRef(false);
  const closeMessage = useCallback(() => setMessage(""), []);
  const closePush = () => {
    if (pushDirty.current) setConfirmDiscard("push");
    else setPushOpen(false);
  };
  const closeDetail = () => {
    setActiveId("");
    detailHistory.current = [];
    requestAnimationFrame(() => detailTrigger.current?.focus());
  };
  const [data, setData] = useState(initialData),
    [view, setView] = useState(initialView),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const [filters, setFilters] = useState({
      source: initialSource,
      settlement: "",
      urgency: "",
      supplierId: "",
      from: "",
      to: "",
      follow: "",
      mine: "",
      sort: "",
      executionStage: initialExecutionStage,
      receiptState: '',
    }),
    [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]),
    [activeId, setActiveId] = useState(initialRecord),
    [detail, setDetail] = useState<PcDetail | null>(null);
  const [selectionRows, setSelectionRows] = useState<Record<string, PcRow>>({});
  const [showSelection, setShowSelection] = useState(false), [selectingAll, setSelectingAll] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountHint, setAccountHint] = useState('');
  const selectionEpoch = useRef(0);
  const clearSelection = useCallback(() => { selectionEpoch.current++; setSelected([]); setSelectionRows({}); setShowSelection(false); }, []);
  const [detailTab, setDetailTab] = useState("overview"),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [form, setForm] = useState<Record<string, string>>({});
  const [fileTargets, setFileTargets] = useState<Record<string, string>>({});
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
  const closeDialog = useCallback(() => {
    if (busyRef.current || uploading) return;
    if (formDirty.current) setConfirmDiscard("form");
    else setDialog(null);
  }, [uploading]);
  const params = useCallback(
    () =>
      new URLSearchParams({
        view,
        task,
        q: query,
        ...filters,
        page: String(page),
        pageSize: "12",
      }),
    [view, task, query, filters, page],
  );
  const selectedRows = selected.map(id => { const live = data.rows.find(row => row.id === id), cached = selectionRows[id]; return cached && (!live || cached.version >= live.version) ? cached : live; }).filter((row): row is PcRow => !!row);
  const selectRows = (rows: PcRow[], checked: boolean) => {
    try {
      const next = pcSelectPage(selected, rows.map(row => row.id), checked);
      setSelectionRows(prior => ({ ...prior, ...Object.fromEntries(rows.map(row => [row.id, row])) }));
      setSelected(next);
    } catch (e) { setError(e instanceof Error ? e.message : '选择失败'); }
  };
  const selectFiltered = async () => {
    const epoch = selectionEpoch.current, query = params(); query.set('selection', '1');
    setSelectingAll(true);
    try {
      const rows = await fetch('/api/purchases?' + query).then(response<PcRow[]>);
      if (epoch !== selectionEpoch.current) return;
      setSelectionRows(Object.fromEntries(rows.map(row => [row.id, row]))); setSelected(rows.map(row => row.id)); setError('');
    } catch (e) { if (epoch === selectionEpoch.current) setError(e instanceof Error ? e.message : '选择失败'); }
    finally { setSelectingAll(false); }
  };
  const changeFilter = (key: keyof typeof filters, value: string) => {
    setFilters((p) => ({ ...p, [key]: value }));
    setPage(1);
    if (selected.length) setMessage('筛选条件已变化，已清空原选择');
    clearSelection();
  };
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search);
      setPage(1);
      clearSelection();
    }, 250);
    return () => clearTimeout(t);
  }, [search, clearSelection]);
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
    formDirty.current = false;
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
        closeDialog();
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
  }, [dialog, closeDialog]);
  useEffect(() => {
    if (initialCreate && !createOpened.current) {
      createOpened.current = true;
      void open("SAVE_REQUEST", []);
    }
    // Only process the initial shortcut once; later data refreshes must not reopen it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!activeId || dialog || pushOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeDetail();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, dialog, pushOpen]);
  useEffect(() => {
    if (!pushOpen) return;
    const previous = document.activeElement as HTMLElement;
    pushDirty.current = false;
    const timer = setTimeout(
      () => pushRef.current?.querySelector<HTMLElement>("button")?.focus(),
      0,
    );
    const handle = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const nodes = Array.from(
        pushRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),a[href]",
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
    document.addEventListener("keydown", handle);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, [pushOpen]);
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
    if (!activeId)
      detailTrigger.current = document.activeElement as HTMLElement;
    else if (activeId !== id) detailHistory.current.push(activeId);
    setActiveId(id);
    setDetailTab("overview");
  };
  function rowFromLine(p: LineDetail): PcRow {
    return {
      fundingIssue: pcFundingIssue(p, user.id, data.settings?.buyerIds || []),
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
      availableCents: Math.max(0, p.payableCents - p.reservedCents + p.refundedCents),
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
    extra?: { returnId?: string; correctionId?: string },
  ) {
    if (busyRef.current) return;
    setFormError("");
    setError("");
    setFiles([]);
    setFileTargets({});
    mutation.current = null;
    try {
      const detailIds = rows.filter(r => r.kind !== 'stock').map(r => r.id);
      const details = detailIds.length ? await fetch('/api/purchases?records=' + encodeURIComponent(detailIds.join(','))).then(response<PcDetail[]>) : [];
      const lines = details.flatMap((d) =>
          d.kind === "line" ? [d.record] : [],
        ),
        fund = details.find(
          (d): d is Extract<PcDetail, { kind: "fund" }> => d.kind === "fund",
        )?.record;
      const p = lines[0],
        r = rows[0];
      const funds = details.flatMap(d => d.kind === "fund" ? [d.record] : []);
      setSelectionRows(prior => ({ ...prior, ...Object.fromEntries(lines.map(l => [l.id, rowFromLine(l)])) }));
      if (action === 'CREATE_FUND') {
        const blocked = lines.map(l => ({ l, issue: pcFundingIssue(l, user.id, data.settings?.buyerIds || []) })).filter(v => v.issue);
        if (blocked.length) { setShowSelection(true); throw new Error(blocked.map(({l, issue}) => `${l.name}：${issue}`).join('；')); }
        if (lines.some(l => l.settlement === 'ADVANCE')) {
          pcReimbursementScope(lines);
          action = 'CREATE_REIMBURSEMENT';
        } else if (pcFundingGroups(lines).length > 1) action = 'BATCH_CREATE_FUNDS';
      }
      const currentRows = rows.map(row => {
        const l = lines.find(l => l.id === row.id), f = funds.find(f => f.id === row.id);
        return l ? rowFromLine(l) : f ? { ...row, number: f.number, name: f.payee, payee: f.payee, account: f.account,
          status: f.status, amountCents: f.amountCents, paidCents: f.paidCents, version: f.version,
          spec: f.allocations.map(al => al.line.name).join('、'), availableCents: Math.max(0, f.amountCents - f.paidCents) } : row;
      });
      const returned = p?.returns.find((x) => x.id === extra?.returnId);
      const correction = p?.amountCorrections.find(c => c.id === extra?.correctionId);
      const f: Record<string, string> = {
        date: today(),
        applicantId: user.id,
        buyerId: user.id,
        receiverId: user.id,
        settlement: p?.settlement || "CORPORATE",
        supplier: p?.supplier?.name || "",
        payee: pcPaymentValue(p?.payee || fund?.payee),
        payeeUserId: p?.payeeUserId || "",
        bank: pcPaymentValue(p?.bank || fund?.bank),
        account: pcPaymentValue(p?.account || fund?.account),
        eta: p?.eta || today(),
        cycle: p?.cycle || "",
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
            action === "CREATE_FUND" || action === 'CREATE_REIMBURSEMENT' ||
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
      if (action === "BATCH_PAY") currentRows.forEach(row => { f["amount:" + row.id] = yuan(row.availableCents); });
      if (action === 'CREATE_REIMBURSEMENT') {
        f.payeeUserId = pcReimbursementScope(lines).payeeUserId;
        f.payee = ''; f.bank = ''; f.account = ''; f.dueDate = '';
        f.confirmLegacyPayee = ''; f.accountEdited = '';
      }
      if (action === "CORRECT_QUANTITY" && p) {
        const legacy = pcLegacyUnit(p.unit);
        f.quantity = String(p.quantity * (legacy?.factor || 1));
        f.unit = legacy?.unit || p.unit;
        f.confirmed = '';
      }
      for (const l of lines) {
        for (const key of ['payee', 'bank', 'account', 'cycle', 'dueDate'] as const) f[key + ':' + l.id] = pcPaymentValue(l[key]);
        f["actual:" + l.id] = yuan(l.actualCents || l.estimateCents);
        f["pricing:" + l.id] = l.status !== "ORDERED" || l.unitPrice ? "UNIT" : "TOTAL";
        f["price:" + l.id] = l.unitPrice || "";
        f["freight:" + l.id] = yuan(l.freightCents);
        f["discount:" + l.id] = yuan(l.discountCents);
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
              quantity: l.quantity ? String(l.quantity) : "",
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
        funds,
        requestId: action === "EDIT_REQUEST" ? p?.requestId : undefined,
        requestVersion: p?.request.version,
        requestDraft: p?.request.status === "DRAFT",
        returnId: returned?.id,
        returnVersion: returned?.version,
        correctionId: correction?.id,
        correctionVersion: correction?.version,
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
      if (action === 'CREATE_REIMBURSEMENT') {
        const scope = pcReimbursementScope(d.lines);
        if (!form.payeeUserId) throw new Error('请选择实际垫付人');
        if (scope.legacyIds.length && form.confirmLegacyPayee !== '1') throw new Error('请确认历史采购的实际垫付人');
        payload.confirmLegacyPayee = form.confirmLegacyPayee === '1';
        payload.amountCents = pcCents(form.amount);
      }
      if (action === 'BATCH_CREATE_FUNDS') {
        payload = { action, groups: pcFundingGroups(d.lines).map(group => {
          const first = group[0];
          return { entries: group.map(l => ({ id: l.id, version: l.version })),
            amountCents: group.reduce((sum, l) => sum + l.payableCents - l.reservedCents + l.refundedCents, 0),
            payee: form['payee:' + first.id], bank: form['bank:' + first.id], account: form['account:' + first.id],
            cycle: form['cycle:' + first.id], dueDate: form['dueDate:' + first.id], reason: form.reason };
        }) };
      }
      if (action === "BATCH_PAY") {
        if (!d.rows.length) throw new Error("请保留至少一笔可登记的资金单");
        payload = { action, entries: d.rows.map(r => {
          if (!["APPROVED", "PARTIAL"].includes(r.status) || r.availableCents <= 0) throw new Error(`${r.number} 当前不可登记，请移除后继续`);
          const amountCents = pcCents(form["amount:" + r.id], `${r.number} 本次付款金额`);
          if (amountCents <= 0 || amountCents > r.availableCents) throw new Error(`${r.number} 本次金额须大于 0 且不超过剩余待付`);
          return { id: r.id, version: r.version, amountCents, date: form["date:" + r.id] || form.date,
            source: form["source:" + r.id] || form.source, reference: form["reference:" + r.id] || form.reference,
            attachmentIds: files.filter(file => fileTargets[file.id] === r.id).map(file => file.id) };
        }), attachmentIds: files.filter(file => !fileTargets[file.id]).map(file => file.id) };
        if (files.some(file => fileTargets[file.id] && !d.rows.some(row => row.id === fileTargets[file.id]))) throw new Error("有凭证仍关联已移除的资金单，请重新选择凭证关联范围");
      }
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
        payload.entries = d.rows.map((r) => ({ id: r.id, version: r.version, itemId: form["item:" + r.id],
          ...pcPurchasePricing(form["pricing:" + r.id] === "UNIT" ? {
            unitPrice: form["price:" + r.id], freightCents: pcCents(form["freight:" + r.id] || "0", "运费"), discountCents: pcCents(form["discount:" + r.id] || "0", "优惠"),
          } : { actualCents: pcCents(form["actual:" + r.id]) }, r.quantity),
        }));
        payload.contractAttachmentIds = files.map((f) => f.id);
      }
      if (action === "CORRECT_QUANTITY") {
        payload.id = d.rows[0].id;
        payload.version = d.rows[0].version;
        payload.quantity = Number(form.quantity);
        payload.confirmed = form.confirmed === "1";
      }
      if (action === "CORRECT_ADVANCE_AMOUNT") {
        const r = d.rows[0];
        payload = { ...payload, id: r.id, version: r.version, ...pcPurchasePricing(form["pricing:" + r.id] === "UNIT" ? {
          unitPrice: form["price:" + r.id], freightCents: pcCents(form["freight:" + r.id] || "0"), discountCents: pcCents(form["discount:" + r.id] || "0"),
        } : { actualCents: pcCents(form["actual:" + r.id]) }, r.quantity) };
      }
      if (["APPROVE_AMOUNT_CORRECTION", "REJECT_AMOUNT_CORRECTION"].includes(action)) {
        payload.correctionId = d.correctionId;
        payload.correctionVersion = d.correctionVersion;
      }
      if (action === "CONTRACT")
        payload.contractAttachmentIds = files.map((f) => f.id);
      if (action === "RECEIVE")
        payload.entries = d.rows.map((r) => ({
          id: r.id,
          version: r.version,
          quantity: Number(form["quantity:" + r.id]),
        }));
      if (action === "RECEIVE") {
        payload.accepted = form.accepted === "1";
        payload.fitConfirmed = form.fitConfirmed === "1";
        payload.continuityConfirmed = form.continuityConfirmed === "1";
      }
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
      }).then(response<{ id?: string; number?: string; duplicates?: unknown[]; status?: string }>);
      setDialog(null);
      clearSelection();
      if (["CORRECT_ADVANCE_AMOUNT", "APPROVE_AMOUNT_CORRECTION", "REJECT_AMOUNT_CORRECTION"].includes(String(payload.action))) setDetailTab("corrections");
      setRevision((n) => n + 1);
      setMessage(
        payload.action === "SAVE_REQUEST"
          ? payload.submit
            ? "采购申请已提交"
            : "草稿已保存"
          : payload.action === 'CREATE_REIMBURSEMENT' ? `报销单 ${result.number} 已提交，共 ${dialog.rows.length} 项采购，等待审批`
          : payload.action === "CORRECT_ADVANCE_AMOUNT" && result.status === "PENDING" ? "金额更正已提交复核，通过后生效" : `${titles[String(payload.action)]}已完成`,
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
      a.download = ["funds", "finance"].includes(view) ? `财务打款及采购明细-${today()}.xlsx` : `采购${PC_VIEWS.find((v) => v.id === view)?.label}-${today()}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出失败");
    }
  }
  const actions = (rows: PcRow[], compact = false, condensed = false) => {
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
      <PurchaseActions condensed={condensed}>
        {line && all(["PENDING"]) && data.permissions.approvePurchase && (
          <>
            {btn("APPROVE_LINES", "通过审批", true)}
            {btn("RETURN_LINES", "退回")}
          </>
        )}
        {line &&
          all(["DRAFT", "RETURNED", "WITHDRAWN"]) &&
          rows.every(r => !r.fixtureId) &&
          rows.length === 1 &&
          btn("EDIT_REQUEST", "修改并提交", true)}
        {line && all(["RETURNED", "WITHDRAWN"]) && rows.some(r => !!r.fixtureId) && <a className="pc-primary" href="/workspace/quality-fixtures?view=plans">返回治具需求重新申购</a>}
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
        {line && all(["ORDERED"]) && rows.length === 1 && data.permissions.buy && btn("UPDATE_SETTLEMENT", "补充收款与结算资料")}
        {line && all(["ORDERED"]) && rows.length === 1 && rows[0].settlement === "ADVANCE" && data.permissions.buy && btn("CORRECT_ADVANCE_AMOUNT", "更正垫付金额")}
        {line && rows.length === 1 && !rows[0].fixtureId && all(["APPROVED", "ORDERED"]) && data.permissions.approvePurchase && btn("CORRECT_QUANTITY", "核对数量与单位")}
        {line && all(["ORDERED"]) && (
          <>
            {rows.every((r) => r.receivedQty + r.cancelledQty < r.quantity) &&
              btn("RECEIVE", "收货入库", true)}
            {btn("INVOICE", "登记发票")}
            {rows.length === 1 && btn("RETURN_GOODS", "退货")}
            {data.permissions.finance &&
              rows.every((r) => r.availableCents > 0) &&
              btn("OFFLINE_PAYMENT", "补录已付款")}
          </>
        )}
        {line && rows.some(r => r.status === 'ORDERED') && btn('CREATE_FUND', '请款 / 报销', true)}
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
        {fund && rows.length > 1 && data.permissions.finance && btn("BATCH_PAY", `批量登记打款（${rows.length} 笔）`, true)}
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
      </PurchaseActions>
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
    'CREATE_REIMBURSEMENT',
    "PAY",
    "BATCH_PAY",
    "OFFLINE_PAYMENT",
    "REFUND",
    "REFUND_HANDOVER",
    "INVOICE",
    "CONTRACT",
    "ATTACH_FILES",
  ].includes(formAction);
  const reimbursementScope = formAction === 'CREATE_REIMBURSEMENT' && dialog?.lines.length ? pcReimbursementScope(dialog.lines) : { payeeUserId: '', legacyIds: [] };
  useEffect(() => {
    if (formAction !== 'CREATE_REIMBURSEMENT' || !form.payeeUserId) { setAccountLoading(false); setAccountHint('请选择实际垫付人，自动读取最近的完整收款信息'); return; }
    const controller = new AbortController(), payerId = form.payeeUserId;
    setAccountLoading(true); setAccountHint('正在读取收款信息…');
    fetch('/api/purchases?' + new URLSearchParams({ lookup: '1', type: 'reimbursement-account', payeeUserId: payerId }), { signal: controller.signal })
      .then(response<{ payer: { id: string; name: string }; account: { payee: string; bank: string; account: string } | null }>)
      .then(result => {
        setForm(current => current.payeeUserId !== payerId ? current : { ...current, payerName: result.payer.name,
          ...(current.accountEdited === '1' ? {} : result.account || { payee: result.payer.name, bank: '', account: '' }) });
        setAccountHint(result.account ? '已带出最近的完整收款信息，请核对后提交' : '暂无完整账户，补充一次即可用于本次全部采购');
      }).catch(error => { if (error.name !== 'AbortError') setAccountHint('最近账户读取失败，可手动填写后提交'); })
      .finally(() => { if (!controller.signal.aborted) setAccountLoading(false); });
    return () => controller.abort();
  }, [formAction, form.payeeUserId]);
  function removeReimbursementLine(id: string) {
    if (!dialog) return;
    const lines = dialog.lines.filter(l => l.id !== id), rows = dialog.rows.filter(r => r.id !== id);
    formDirty.current = true; selectionEpoch.current++;
    setDialog({ ...dialog, lines, rows }); setSelected(ids => ids.filter(value => value !== id));
    setForm(current => ({ ...current, amount: yuan(sum(rows, 'availableCents')), confirmLegacyPayee: '' }));
  }
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
          <div className="pc-eyebrow">杭连 · 采购与物资</div>
          <h1>
            <span id="pc-nav-trigger" />
            采购工作台 <span>采购闭环管理</span>
          </h1>
          <div className="pc-actions" style={{ marginTop: 10 }}>
            <button aria-pressed={filters.source === "NORMAL"} onClick={() => changeFilter("source", "NORMAL")}>普通采购</button>
            <button aria-pressed={filters.source === "FIXTURE"} onClick={() => changeFilter("source", "FIXTURE")}>治具申购</button>
            {filters.source === "FIXTURE" && <a href="/workspace/quality-fixtures?view=fixtures">进入治具库 →</a>}
          </div>
        </div>
        <div className="pc-actions">
          <button
            onClick={() => setRevision((n) => n + 1)}
            aria-label="刷新采购"
          >
            <RefreshCw size={16} />
          </button>
          <button onClick={() => setPushOpen(true)}>
            <Bell size={16} />
            群推送
          </button>
          {data.permissions.configure && (
            <button onClick={() => void open("SAVE_SETTINGS")}>
              <Settings size={15} />
              流程设置
            </button>
          )}
          <button
            className="pc-primary"
            onClick={() => filters.source === "FIXTURE" ? window.location.assign("/workspace/quality-fixtures?view=plans") : void open("SAVE_REQUEST")}
          >
            <Plus size={17} />
            {filters.source === "FIXTURE" ? "从治具需求申购" : "发起请购"}
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
      <PurchaseToast message={message} close={closeMessage} />
      <div className="pc-layout">
        <aside className="pc-menu">
          <div className="pc-menu-label">工作队列</div>
          {PC_VIEWS.map((v) => (
            <button
              key={v.id}
              className={view === v.id ? "active" : ""}
              onClick={() => {
                setView(v.id);
                setTask("");
                setPage(1);
                clearSelection();
                setActiveId("");
                setFilters((f) => ({ ...f, follow: "", executionStage: "pending" }));
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
              {view === "execution" && <small>{filters.executionStage === "pending" ? "预算合计" : filters.executionStage === "ordered" ? "采购应付合计" : "预算及采购应付合计"}</small>}
            </div>
          </div>
          {view === "execution" && <div className="pc-execution-tabs" role="group" aria-label="采购执行分类">
            {PC_EXECUTION_STAGES.map(stage => <button key={stage.id} type="button" aria-pressed={filters.executionStage === stage.id} className={filters.executionStage === stage.id ? "active" : ""} onClick={() => { changeFilter("executionStage", stage.id); setActiveId(""); }}>
              {stage.label}<b>{data.executionCounts?.[stage.id] ?? "—"}</b><small>项</small>
            </button>)}
          </div>}
          <div className="pc-filters">
            {task && (
              <button
                className="pc-task-filter"
                onClick={() => {
                  setTask("");
                  setPage(1);
                  clearSelection();
                }}
              >
                {{
                  approval: "待我审批",
                  execution: "待我采购",
                  finance: "待我付款",
                  requests: "我的申请",
                }[task] || "个人待办"}{" "}
                <X size={14} aria-hidden="true" />
                <span className="sr-only">清除个人筛选</span>
              </button>
            )}
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
            {!['stock', 'funds', 'finance'].includes(view) && <select aria-label="入库状态" value={filters.receiptState} onChange={e => changeFilter('receiptState', e.target.value)}><option value="">全部入库状态</option>{Object.entries(PC_RECEIPT_STATES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>}
            <button className="pc-export" onClick={() => void exportRows()}>
              <ArrowDownToLine size={15} />
              {selected.length ? "导出选中" : "导出筛选结果"}
            </button>
          </div>
          {selected.length > 0 && (
            <div className="pc-selection">
              <span>
                已选 {selected.length} 项 ·{" "}
                {selectedRows.every(r => r.kind === "fund") ? `剩余待付 ${pcMoney(sum(selectedRows, "availableCents"))}` : `采购金额 ${pcMoney(sum(selectedRows, "amountCents"))} · 可申请 ${pcMoney(sum(selectedRows.filter(r => r.kind === 'line' && !r.fundingIssue && r.status === 'ORDERED'), 'availableCents'))}`}
              </span>
              {actions(selectedRows, true)}
              <button onClick={() => setShowSelection(v => !v)}>{showSelection ? '收起已选' : '查看已选'}</button>
              {selectedRows.some(r => r.kind === 'line' && r.fundingIssue) && <button onClick={() => setSelected(selectedRows.filter(r => r.kind === 'line' && !r.fundingIssue).map(r => r.id))}>仅保留可请款 / 报销</button>}
              <button onClick={clearSelection}>取消选择</button>
            </div>
          )}
          <div className="pc-selection-tools">
            <span>表头勾选本页；翻页保留选择。单批最多 100 项。</span>
            <button disabled={loading || selectingAll || !data.total} onClick={() => void selectFiltered()}>{selectingAll ? '正在读取…' : `选择全部筛选结果（${data.total} 项）`}</button>
          </div>
          {showSelection && selected.length > 0 && <div className="pc-selected-list" aria-label="跨页已选明细">{selectedRows.map(r => <div key={r.id}><span><b>{r.name}</b><small>{r.number} · {r.fundingIssue || (r.kind === 'line' ? `可申请 ${pcMoney(r.availableCents)}` : `待付 ${pcMoney(r.availableCents)}`)}</small></span><button onClick={() => selectRows([r], false)} aria-label={'移除选择 ' + r.number}>移除</button></div>)}</div>}
          <div className="pc-table-wrap" aria-busy={loading} data-page={data.page}>
            <table className="pc-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="选择当前页全部记录"
                      disabled={loading || selectingAll}
                      ref={el => { if (el) el.indeterminate = data.rows.some(r => selected.includes(r.id)) && !data.rows.every(r => selected.includes(r.id)); }}
                      checked={
                        !!data.rows.length &&
                        data.rows.every((r) => selected.includes(r.id))
                      }
                      onChange={(e) => selectRows(data.rows, e.target.checked)}
                    />
                  </th>
                  <th>{view === "stock" ? "物资 / 来源" : "物品 / 单号"}</th>
                  {!["stock", "finance", "funds"].includes(view) && <th className="pc-quantity-column">采购数量</th>}
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
                        disabled={loading || selectingAll}
                        onChange={(e) => selectRows([r], e.target.checked)}
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

                      </small>
                      <span className="pc-number">{r.number}</span>
                    </td>
                    {!["stock", "finance", "funds"].includes(view) && <td className="pc-quantity-column"><PurchaseQuantity quantity={r.quantity} unit={r.unit} /></td>}
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
                              : r.kind === "fund" ? PC_FUND_STATES[r.status] || r.status : PC_STATES[r.status]}
                          </span>
                          {r.kind === 'line' && (() => { const receipt = pcReceiptState(r); return <div className="pc-receipt"><strong className={'pc-receipt-badge ' + receipt.state.toLowerCase()}>{receipt.state === 'RECEIVED' ? '✓ ' : ''}{receipt.label}</strong>{r.status === 'ORDERED' && <small>已入库 {r.receivedQty} / {receipt.expected} {r.unit} · 待收 {receipt.pending} {r.unit}</small>}{receipt.returned > 0 && <small className="pc-warning">已退货 {receipt.returned} {r.unit}</small>}</div>; })()}
                          {r.status === "ORDERED" ? (
                            <small>
                              已付 {pcMoney(r.paidCents)}
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
                  setLoading(true);
                  setPage((p) => p - 1);
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
                  setLoading(true);
                  setPage((p) => p + 1);
                }}
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </footer>
        </section>
      </div>
      {activeId && (
        <aside
          ref={detailRef}
          className={"pc-detail" + (expanded ? " pc-detail-expanded" : "")}
          aria-label="采购记录详情"
          tabIndex={-1}
        >
          <header>
            <div>
              <small>{line?.number || fund?.number || "采购详情"}</small>
              <h2>{line?.name || fund?.number || "采购详情"}</h2>
            </div>
            <div className="pc-detail-tools">
              {detailHistory.current.length > 0 && (
                <button
                  onClick={() => {
                    const id = detailHistory.current.pop();
                    if (id) {
                      setActiveId(id);
                      setDetailTab("overview");
                    }
                  }}
                  aria-label="返回上一条记录"
                >
                  <ChevronLeft size={19} />
                </button>
              )}
              <button
                aria-label="复制采购编号"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(line?.number || fund?.number || "")
                    .then(() => setMessage("编号已复制"))
                    .catch(() => setError("复制失败，请手动复制编号"));
                }}
              >
                <Copy size={17} />
              </button>
              <button
                aria-label={expanded ? "收起详情" : "展开详情"}
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              </button>
              <button aria-label="关闭详情" onClick={closeDetail}>
                <X size={20} />
              </button>
            </div>
          </header>
          {!detail ? (
            <div className="pc-empty">正在加载…</div>
          ) : (
            <>
              <nav className="pc-detail-tabs">
                {[
                  ["overview", "业务概览"],
                  ...(line
                    ? [
                        ["finance", "资金票据"],
                        ...(line.settlement === "ADVANCE" ? [["corrections", "金额更正" + (line.amountCorrections.some(c => c.status === "PENDING") ? " · 待复核" : "")]] : []),
                        ["stock", "收货售后"],
                      ]
                    : []),
                  ["files", "附件凭证"],
                  ["history", "操作记录"],
                  ["push", "推送记录"],
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
                {["overview", "finance", "stock", "corrections"].includes(detailTab) &&
                  line && (
                    <>
                      {detailTab === "overview" && (
                        <>
                          <div className="pc-next-step">
                            <strong>
                              {line.completedAt
                                ? "采购已完成"
                                : PC_STATES[line.status]}
                            </strong>
                            <p>{purchasingNextStep(line)}</p>
                            <span>
                              {line.urgency === "CRITICAL"
                                ? "特急"
                                : line.urgency === "URGENT"
                                  ? "紧急"
                                  : "普通"}{" "}
                              · 经办：{line.buyerName || "待指定"}
                            </span>
                          </div>
                          <div className="pc-detail-amount">
                            <span>
                              {line.status === "ORDERED"
                                ? "净应付金额"
                                : "预估金额"}
                            </span>
                            <strong>
                              {pcMoney(
                                line.status === "ORDERED"
                                  ? line.payableCents
                                  : line.estimateCents,
                              )}
                            </strong>
                            <span className="pc-badge">
                              {line.completedAt
                                ? "已完成"
                                : PC_STATES[line.status]}
                            </span>
                          </div>
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
                                <b>
                                  {pcMoney(line.paidCents - line.refundedCents)}
                                </b>
                              </div>
                              <div>
                                <small>已关联发票</small>
                                <b>{pcMoney(line.invoiceCents)}</b>
                              </div>
                            </div>
                          )}
                          {line.status === "ORDERED" && (
                            <div className="pc-progress-grid">
                              <div>
                                <small>采购金额</small>
                                <b>{pcMoney(line.actualCents)}</b>
                              </div>
                              <div>
                                <small>未付 / 待退</small>
                                <b>
                                  {pcMoney(
                                    Math.max(
                                      0,
                                      line.payableCents -
                                        line.paidCents +
                                        line.refundedCents,
                                    ),
                                  )}{" "}
                                  /{" "}
                                  {pcMoney(
                                    line.returns.reduce(
                                      (n, r) =>
                                        n +
                                        r.refundDueCents -
                                        r.companyReceivedCents,
                                      0,
                                    ),
                                  )}
                                </b>
                              </div>
                            </div>
                          )}

                          <Facts>
                            <Fact label="采购编号">{line.number}</Fact>
                            {line.status === "ORDERED" && <>
                              <Fact label={line.unitPrice ? "登记成交单价" : "总额折算单价"}>{line.unitPrice ? Number(line.unitPrice).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 6 }) : (line.actualCents / 100 / line.quantity).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} 元 / {line.unit}</Fact>
                              {line.unitPrice ? <><Fact label="商品金额">{pcMoney(line.goodsCents || 0)}</Fact><Fact label="登记运费 / 优惠">{pcMoney(line.freightCents)} / {pcMoney(line.discountCents)}</Fact></> : <Fact label="单价依据">总额折算，可能包含运费或优惠</Fact>}
                            </>}
                            <Fact label="申请 / 提交">
                              {line.request.applicantName} /{" "}
                              {line.request.submitterName}
                            </Fact>
                            <Fact label="物品规格">
                              {line.spec}
                            </Fact>
                            <Fact label="采购数量"><PurchaseQuantity quantity={line.quantity} unit={line.unit} /></Fact>
                            <Fact label="需求日期">{line.needDate}</Fact>
                            <Fact label="采购用途">{line.request.purpose}</Fact>
                            <Fact label="关联工单">
                              {line.request.workOrderCode}
                            </Fact>
                            <Fact label="供应商">{line.supplier?.name}</Fact>
                            <Fact label="结算方式">
                              {PC_SETTLEMENTS[line.settlement]}
                            </Fact>
                            <Fact label="采购经办">{line.buyerName}</Fact>
                            <Fact label="预计到货">{line.eta}</Fact>
                            {line.settlement === "MONTHLY" && (
                              <Fact label="月结账期">
                                {line.cycle || "账期待确认"} · {line.dueDate ? `${line.dueDate} 到期` : "付款日期未约定"}
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
                        </>
                      )}
                      {detailTab === "finance" && (
                        <>
                          <Facts>
                            {" "}
                            <Fact label="收款人">{pcPaymentValue(line.payee) || "待补充"}</Fact>
                            <Fact label="银行 / 账户">
                              {pcPaymentValue(line.bank) || "银行待补充"} · {pcPaymentValue(line.account) || "账号待补充"}
                            </Fact>
                          </Facts>
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
                        </>
                      )}
                      {detailTab === "corrections" && <>                          {line.amountCorrections.length > 0 && <section aria-label="垫付金额更正记录">
                            <h3>垫付金额更正</h3>
                            {line.amountCorrections.map(c => <div className="pc-log" key={c.id}>
                              <b>{pcMoney(Number((c.before as Record<string, unknown>).actualCents))} → {pcMoney(Number((c.after as Record<string, unknown>).actualCents))} · {({ PENDING: '待复核', APPLIED: '已生效', REJECTED: '已退回' } as Record<string, string>)[c.status]}</b>
                              <p>{c.reason}</p><small>{c.actorName} · {time(c.createdAt)}{c.reviewedAt ? ` · ${c.reviewerName}复核：${c.reviewReason || '直接生效'}` : ` · 等待${c.reviewRole === 'FINANCE' ? '财务' : '资金审批负责人'}复核`}</small>
                              {c.status === 'PENDING' && <p className="pc-warning">复核期间暂停关联资金付款和金额变更。通过后释放原资金单未付余额，按新余额重新请款；历史付款、发票和库存数量保留。</p>}
                              {c.status === 'PENDING' && (c.reviewRole === 'FINANCE' ? data.permissions.finance : data.permissions.approveFund) && <div className="pc-actions">
                                <button onClick={() => void open('APPROVE_AMOUNT_CORRECTION', [rowFromLine(line)], { correctionId: c.id })}>通过金额更正</button>
                                <button onClick={() => void open('REJECT_AMOUNT_CORRECTION', [rowFromLine(line)], { correctionId: c.id })}>退回金额更正</button>
                              </div>}
                            </div>)}
                          </section>}
{!line.amountCorrections.length && <p className="pc-muted">暂无金额更正记录</p>}</>}
                      {detailTab === "stock" && (
                        <>
                          <h3>收货与库存</h3>
                          {!line.receipts.length && (
                            <p className="pc-muted">
                              尚未收货。登记采购后可分批办理，月结无需等待付款。
                            </p>
                          )}
                          {line.receipts.map((r) => (
                            <div className="pc-log" key={r.id}>
                              <b>
                                {r.date} · {pcQuantityText(r.quantity, r.unit || line.unit)}
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
                                    {pcQuantityText(m.quantity, m.unit || line.unit)} · 结存 {pcQuantityText(m.balance, m.unit || line.unit)}
                                    <small>
                                      {m.person} {m.reason} · {m.actorName}
                                    </small>
                                  </p>
                                ))}
                              </details>
                            </div>
                          ))}
                          <h3>退货与退款 / 更正差额</h3>
                          {line.returns.length === 0 && (
                            <p className="pc-muted">暂无退货记录</p>
                          )}
                          {line.returns.map((r) => (
                            <div className="pc-log" key={r.id}>
                              <b>
                                {r.number} · {r.kind === "AMOUNT_CORRECTION" ? "金额更正差额" : pcQuantityText(r.quantity, r.unit || line.unit)}
                              </b>
                              <small>
                                {r.kind === "AMOUNT_CORRECTION" ? "价格更正，库存数量保持不变" : r.kind === "STOCK" ? "在库退货" : "未入库退货"}{" "}
                                · 冲减 {pcMoney(r.amountCents)} · {r.reason}
                              </small>
                              <p>
                                应退 {pcMoney(r.refundDueCents)} / 公司到账{" "}
                                {pcMoney(r.companyReceivedCents)}
                              </p>
                              {r.refundedCents > r.companyReceivedCents && (
                                <p className="pc-warning">
                                  个人已收待归还{" "}
                                  {pcMoney(
                                    r.refundedCents - r.companyReceivedCents,
                                  )}
                                </p>
                              )}
                              {data.permissions.finance && (
                                <div className="pc-actions">
                                  {r.refundDueCents > r.refundedCents && (
                                    <button
                                      onClick={() =>
                                        void open(
                                          "REFUND",
                                          [rowFromLine(line)],
                                          {
                                            returnId: r.id,
                                          },
                                        )
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
                        </>
                      )}
                      {detailTab === "finance" && (
                        <>
                          <h3>合同与发票</h3>
                          {!line.contractLines.length &&
                            !line.invoiceLines.length && (
                              <p className="pc-muted">暂无合同或发票记录。</p>
                            )}
                          {line.contractLines.map((c) => (
                            <a
                              key={c.id}
                              className="pc-related"
                              href={
                                "/workspace/purchases/contracts/" + c.contractId
                              }
                              target="_blank"
                              rel="noreferrer"
                            >
                              <b>
                                {c.contract.number} · 第 {c.contract.revision}{" "}
                                版 ↗
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
                                本项关联 {pcMoney(i.amountCents)} ·{" "}
                                {i.invoice.date}
                              </small>
                            </div>
                          ))}
                        </>
                      )}
                      {detailTab === "overview" &&
                        line.request.lines.length > 1 && (
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
                {detailTab === "push" && (
                  <PurchasePushPanel record={activeId} />
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
                        {p.batch && <small>付款批次：{p.batch.number}</small>}
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
                        <small>{Math.ceil(f.size / 1024)} KB · {f.entityType === "PAYMENT_BATCH" ? "批次共用凭证 · " : ""}点击查看</small>
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
                {line && actions([rowFromLine(line)], false, true)}
                {fund &&
                  actions(
                    [
                      {
                        id: fund.id,
                        version: fund.version,
                        kind: "fund",
                        status: fund.status,
                        paidCents: fund.paidCents,
                      } as PcRow,
                    ],
                    false,
                    true,
                  )}
              </footer>
            </>
          )}
        </aside>
      )}
      {pushOpen && (
        <div
          className="pc-overlay"
          onKeyDown={(e) => {
            if (e.key === "Escape") closePush();
          }}
        >
          <div
            ref={pushRef}
            className="pc-dialog pc-push-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="采购群推送设置"
          >
            <header>
              <h2>群推送与发送记录</h2>
              <button aria-label="关闭推送设置" onClick={closePush}>
                <X size={21} />
              </button>
            </header>
            <div className="pc-dialog-body">
              <PurchasePushPanel
                onDirty={(v) => {
                  pushDirty.current = v;
                }}
              />
            </div>
          </div>
        </div>
      )}
      {dialog && (
        <div className="pc-overlay">
          <div
            className={"pc-dialog " + (requestForm || ['BATCH_PAY', 'BATCH_CREATE_FUNDS', 'CREATE_REIMBURSEMENT'].includes(formAction) ? "pc-dialog-wide" : "")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pc-dialog-title"
            ref={formRef}
            onChangeCapture={() => {
              formDirty.current = true;
            }}
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
                onClick={closeDialog}
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
                  <datalist id="pc-unit-options">{PC_UNITS.map(unit => <option key={unit} value={unit} />)}</datalist>
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
                                list={key === "unit" ? "pc-unit-options" : undefined}
                                className={key === "quantity" ? "pc-quantity-input" : undefined}
                                placeholder={key === "quantity" ? "请填写实际数量" : key === "unit" ? "件 / 个 / 包等" : undefined}
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
                !["SAVE_SETTINGS", "BATCH_PAY", "BATCH_CREATE_FUNDS", 'CREATE_REIMBURSEMENT'].includes(formAction) &&
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
                {formAction === 'CREATE_REIMBURSEMENT' && <section className="pc-wide pc-reimbursement">
                  <div className="pc-reimbursement-total"><span>已选 <b>{dialog.rows.length}</b> 项 · 一张报销单</span><strong>本次报销 {pcMoney(Math.round(Number(form.amount || '0') * 100))}</strong><small>可报销余额 {pcMoney(sum(dialog.rows, 'availableCents'))}</small></div>
                  <div className="pc-form-grid">
                    <Field label="实际垫付人" wide><select value={form.payeeUserId || ''} disabled={!!reimbursementScope.payeeUserId} onChange={e => { setForm(current => ({ ...current, payeeUserId: e.target.value, payee: '', bank: '', account: '', payerName: '', accountEdited: '', confirmLegacyPayee: '' })); }}>
                      <option value="">请选择实际垫付人</option>
                      {form.payeeUserId && !data.users.some(u => u.id === form.payeeUserId) && <option value={form.payeeUserId}>{form.payerName || '历史垫付人'}</option>}
                      {data.users.map(u => <option value={u.id} key={u.id}>{u.name}</option>)}
                    </select></Field>
                    <p className="pc-wide pc-hint" role="status">{accountHint}</p>
                    {(['payee', 'bank', 'account'] as const).map((key, index) => <Field key={key} label={['收款人 / 单位', '开户银行', '收款账号'][index]} wide={key === 'account'}><input autoComplete="off" value={form[key] || ''} onChange={e => setForm(current => ({ ...current, [key]: e.target.value, accountEdited: '1' }))} /></Field>)}
                    {reimbursementScope.legacyIds.length > 0 && <label className="pc-wide pc-check pc-legacy-payee"><input type="checkbox" checked={form.confirmLegacyPayee === '1'} onChange={e => set('confirmLegacyPayee', e.target.checked ? '1' : '')} />已核实：{reimbursementScope.legacyIds.length} 项历史采购未登记实际垫付人，均由本次所选人员实际垫付</label>}
                  </div>
                  <details className="pc-reimbursement-details"><summary>查看 {dialog.rows.length} 项采购明细</summary><div className="pc-reimbursement-scroll"><table><thead><tr><th>物品 / 单号</th><th>数量</th><th>单价</th><th>可报销金额</th><th>操作</th></tr></thead><tbody>{dialog.lines.map(l => <tr key={l.id}><td><b>{l.name}</b><small>{l.number}</small>{!l.payeeUserId && <small>历史垫付人待本次核实</small>}</td><td>{pcQuantityText(l.quantity, l.unit)}</td><td>{l.unitPrice || '总额登记'}</td><td>{pcMoney(l.payableCents - l.reservedCents + l.refundedCents)}</td><td><button onClick={() => removeReimbursementLine(l.id)} aria-label={'移除报销项目 ' + l.number}>移除</button></td></tr>)}</tbody></table></div></details>
                  <details className="pc-reimbursement-details"><summary>其他信息（选填）</summary><div className="pc-form-grid"><Field label="申请金额（元）">{input('amount', 'number')}</Field><Field label="期望付款日期">{input('dueDate', 'date')}</Field><p className="pc-wide pc-hint">默认报销全部可用余额；可减少本次金额，剩余金额以后继续申请。</p><Field label="报销备注" wide><textarea value={form.reason || ''} onChange={e => set('reason', e.target.value)} /></Field></div></details>
                </section>}
                {formAction === 'BATCH_CREATE_FUNDS' && <section className="pc-wide pc-batch-payment">
                  <p className="pc-banner">按收款人、账户、结算方式及账期分为 {pcFundingGroups(dialog.lines).length} 组。每组按可申请余额生成一张资金单，任一组校验失败时整批不提交。部分请款可返回后单独选择一组办理。</p>
                  {pcFundingGroups(dialog.lines).map((group, index) => { const first = group[0]; return <section className="pc-batch-payment-row" key={first.id}>
                    <h3>第 {index + 1} 组 · {PC_SETTLEMENTS[first.settlement]} · {pcMoney(group.reduce((n, l) => n + l.payableCents - l.reservedCents + l.refundedCents, 0))}</h3>
                    <ul>{group.map(l => <li key={l.id}>{l.name} · {pcQuantityText(l.quantity, l.unit)} · {pcMoney(l.payableCents - l.reservedCents + l.refundedCents)}</li>)}</ul>
                    <div className="pc-form-grid"><Field label={`第 ${index + 1} 组收款人`}>{input('payee:' + first.id)}</Field><Field label={`第 ${index + 1} 组开户银行`}>{input('bank:' + first.id)}</Field><Field label={`第 ${index + 1} 组收款账号`} wide>{input('account:' + first.id)}</Field>
                    {first.settlement === 'MONTHLY' && <Field label={`第 ${index + 1} 组账期（选填）`}>{input('cycle:' + first.id, 'month')}</Field>}<Field label={`第 ${index + 1} 组期望付款日期（选填）`}>{input('dueDate:' + first.id, 'date')}</Field></div>
                  </section>; })}
                  <Field label="收款信息变更原因 / 备注" wide>{input('reason')}</Field>
                </section>}
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
                        <Field label="月结账期（选填，未确定可留空）">
                          {input("cycle", "month")}
                        </Field>
                        <Field label="付款到期日期（选填，未约定可留空）">
                          {input("dueDate", "date")}
                        </Field>
                      </>
                    )}
                    {dialog.lines.map((l) => (
                      <div className="pc-wide pc-purchase-line" key={l.id}>
                        <div className="pc-wide pc-pricing-title"><strong>{l.name}</strong><span>{l.spec}</span><PurchaseQuantity quantity={l.quantity} unit={l.unit} /></div>
                        <Field label="金额录入方式">{select("pricing:" + l.id, { UNIT: "按成交单价登记", TOTAL: "仅有总额（折算单价）" })}</Field>
                        {form["pricing:" + l.id] === "UNIT" ? <>
                          <Field label={l.name + " · 成交单价（元）"}><input type="number" min="0.000001" step="0.000001" required value={form["price:" + l.id] || ""} onChange={e => set("price:" + l.id, e.target.value)} /></Field>
                          <Field label={l.name + " · 运费（元）"}>{input("freight:" + l.id, "number")}</Field>
                          <Field label={l.name + " · 优惠（元）"}>{input("discount:" + l.id, "number")}</Field>
                          <div className="pc-wide pc-pricing-total">{(() => { try { const p = pcPurchasePricing({ unitPrice: form["price:" + l.id], freightCents: pcCents(form["freight:" + l.id] || "0"), discountCents: pcCents(form["discount:" + l.id] || "0") }, l.quantity); return <>商品金额 {pcMoney(p.goodsCents || 0)}<strong>采购总额 {pcMoney(p.actualCents)}</strong></>; } catch { return <span>填写单价后，按数量计算商品金额，再加运费、减优惠。</span>; } })()}</div>
                        </> : <><Field label={l.name + " · 实际采购总额（元）"}>{input("actual:" + l.id, "number")}</Field><p className="pc-wide pc-hint">此方式仅记录总额，导出会注明“总额折算”，不会将其作为登记成交单价。</p></>}
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
                {formAction === "CORRECT_ADVANCE_AMOUNT" && dialog.lines.map(l => <div className="pc-wide pc-purchase-line" key={l.id}>
                  <p className="pc-wide pc-banner">已入库 {pcQuantityText(l.receivedQty, l.unit)}，原总额 {pcMoney(l.actualCents)}。更正仅调整价格；库存数量、历史付款和发票保持原记录。已有资金申请、付款或票据时提交复核；多付形成待退差额，少付可重新申请余额。</p>
                  <Field label="金额录入方式">{select('pricing:' + l.id, { UNIT: '按成交单价更正', TOTAL: '按采购总额更正' })}</Field>
                  {form['pricing:' + l.id] === 'UNIT' ? <>
                    <Field label="更正后成交单价（元）"><input type="number" min="0.000001" step="0.000001" value={form['price:' + l.id] || ''} onChange={e => set('price:' + l.id, e.target.value)} /></Field>
                    <Field label="运费（元）">{input('freight:' + l.id, 'number')}</Field>
                    <Field label="优惠（元）">{input('discount:' + l.id, 'number')}</Field>
                    <p className="pc-wide">{(() => { try { return '更正后总额 ' + pcMoney(pcPurchasePricing({ unitPrice: form['price:' + l.id], freightCents: pcCents(form['freight:' + l.id] || '0'), discountCents: pcCents(form['discount:' + l.id] || '0') }, l.quantity).actualCents); } catch { return '请核对单价、运费和优惠'; } })()}</p>
                  </> : <Field label="更正后采购总额（元）">{input('actual:' + l.id, 'number')}</Field>}
                  <Field label="补充合同编号（达到 500 元且未关联合同时必填）" wide>{input('contractNumber')}</Field>
                </div>)}
                {["APPROVE_AMOUNT_CORRECTION", "REJECT_AMOUNT_CORRECTION"].includes(formAction) && (() => { const c = dialog.lines[0]?.amountCorrections.find(c => c.id === dialog.correctionId); return c ? <div className="pc-wide pc-banner">{pcMoney(Number((c.before as Record<string, unknown>).actualCents))} → {pcMoney(Number((c.after as Record<string, unknown>).actualCents))}。申请原因：{c.reason}。通过后关闭关联资金单的未付款余额，保留已付款事实；报销差额需按实际再次请款或登记退款。</div> : <p className="pc-wide pc-warning">更正记录已变化，请关闭后刷新。</p>; })()}
                {formAction === "CORRECT_QUANTITY" && <>
                  <div className="pc-wide pc-banner">原登记：数量 {dialog.lines[0]?.quantity}；单位「{dialog.lines[0]?.unit}」。请依据实际采购核对，以下建议值不会自动保存。更正保留采购总额和历史资金单；已有收货时仅支持历史单位的整数换算。</div>
                  <Field label="核实后的采购数量"><input className="pc-quantity-input" type="number" min="1" step="1" value={form.quantity || ''} onChange={e => set('quantity', e.target.value)} /></Field>
                  <Field label="核实后的单位"><input list="pc-correction-units" value={form.unit || ''} onChange={e => set('unit', e.target.value)} /><datalist id="pc-correction-units">{PC_UNITS.map(unit => <option key={unit} value={unit} />)}</datalist></Field>
                  <div className="pc-wide"><PurchaseQuantity quantity={Number(form.quantity)} unit={form.unit || ''} /></div>
                  <label className="pc-wide pc-check"><input type="checkbox" checked={form.confirmed === '1'} onChange={e => set('confirmed', e.target.checked ? '1' : '')} />已核对实际采购与实物数量，确认采购总额保持不变</label>
                </>}
                {formAction === "UPDATE_SETTLEMENT" && <>
                  <p className="pc-wide pc-hint">{form.supplier} · {PC_SETTLEMENTS[form.settlement]}。收货后仍可补充；已提交的资金单保留原收款信息，后续请款使用补充后的资料。</p>
                  {form.settlement === "MONTHLY" && <><Field label="月结账期（选填，未确定可留空）">{input('cycle', 'month')}</Field><Field label="付款到期日期（选填，未约定可留空）">{input('dueDate', 'date')}</Field></>}
                </>}
                {["PURCHASE", "CREATE_FUND", "OFFLINE_PAYMENT", "UPDATE_SETTLEMENT"].includes(formAction) && (
                  <>
                    <p className="pc-wide pc-hint">{["PURCHASE", "UPDATE_SETTLEMENT"].includes(formAction) ? "收款信息可后补，以下三项均非必填；请款前需补齐有效资料。" : "请款前需填写完整有效的收款信息。首次补充不需要填写变更原因。"}</p>
                    <Field label="收款人 / 单位">{input("payee")}</Field>
                    <Field label="开户银行">{input("bank")}</Field>
                    <Field label="收款账号" wide>
                      {input("account")}
                    </Field>
                    {["PURCHASE", "UPDATE_SETTLEMENT", "CREATE_FUND", "OFFLINE_PAYMENT"].includes(formAction) && (
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
                    {form.settlement === "MONTHLY" && <Field label="月结账期（单项请款可留空）">{input("cycle", "month")}</Field>}
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
                {formAction === "BATCH_PAY" && <section className="pc-batch-payment pc-wide">
                  <p className="pc-banner">登记已经发生的付款。默认按剩余待付金额填写，可逐笔修改；同一笔转账可共用流水号和凭证。任一笔校验失败时整批不登记。</p>
                  <div className="pc-form-grid">
                    <Field label="统一付款日期">{input("date", "date")}</Field>
                    <Field label="统一公司付款账户">{input("source")}</Field>
                    <Field label="统一银行流水号（同一笔转账时填写）" wide>{input("reference")}</Field>
                  </div>
                  <div className="pc-batch-payment-list">
                    {dialog.rows.map(r => {
                      const eligible = ["APPROVED", "PARTIAL"].includes(r.status) && r.availableCents > 0;
                      return <section className="pc-batch-payment-row" key={r.id} aria-label={`付款 ${r.number}`}>
                        <header><div><b>{r.payee || r.name || "收款人待补充"}</b><small>{r.number} · 账号 {r.account ? '尾号 ' + r.account.slice(-4) : '待补充'}</small><p>{r.spec}</p></div>
                          <button disabled={busy} onClick={() => { formDirty.current = true; setDialog(current => current ? { ...current, rows: current.rows.filter(row => row.id !== r.id) } : current); }}>移除本笔</button></header>
                        <p>已付 {pcMoney(r.paidCents)} · 剩余待付 <b>{pcMoney(r.availableCents)}</b></p>
                        {!eligible ? <p className="pc-error">当前状态：{PC_FUND_STATES[r.status] || r.status}，不可登记，请移除本笔后继续。</p> : <>
                          <div className="pc-form-grid">
                            <Field label={`${r.number} 本次付款金额（元）`}>{input("amount:" + r.id, "number")}</Field>
                            <Field label={`${r.number} 银行流水号`}>{input("reference:" + r.id, "text")}</Field>
                          </div>
                          <details><summary>单独设置付款日期 / 付款账户（留空沿用统一填写）</summary><div className="pc-form-grid">
                            <Field label={`${r.number} 付款日期`}>{input("date:" + r.id, "date")}</Field>
                            <Field label={`${r.number} 公司付款账户`}>{input("source:" + r.id)}</Field>
                          </div></details>
                        </>}
                      </section>;
                    })}
                  </div>
                  <p className="pc-batch-payment-total">本次登记 {dialog.rows.length} 笔 · 合计 <strong>{(() => { try { return pcMoney(dialog.rows.reduce((total, r) => total + pcCents(form["amount:" + r.id]), 0)); } catch { return '请核对金额'; } })()}</strong></p>
                </section>}
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
                    {dialog.lines.some(l => !!l.fixtureId) && <>
                      <Field label="治具验收状态">{select("fixtureDisposition", { HELD: "待组装 / 待验证", AVAILABLE: "已验证，可用入库" })}</Field>
                      <Field label="验收说明">{input("acceptanceNote")}</Field>
                      <Field label="实物验收">{select("accepted", { "": "请选择", "1": "已核对型号、数量及实物" })}</Field>
                      {form.fixtureDisposition === "AVAILABLE" && <>
                        <Field label="对插适配">{select("fitConfirmed", { "": "请选择", "1": "验证通过" })}</Field>
                        <Field label="导通验证">{select("continuityConfirmed", { "": "请选择", "1": "验证通过" })}</Field>
                      </>}
                      <p className="pc-banner pc-wide">治具收货直接计入治具库；待组装、待验证库存不计入可用量。</p>
                    </>}
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
                    {dialog.lines[0]?.fixtureId && <Field label="治具退货来源">{select("fixtureDisposition", { AVAILABLE: "可用库存", HELD: "待验证库存", REPAIR: "维修中库存" })}</Field>}
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
                    'CREATE_REIMBURSEMENT',
                  ].includes(formAction) && (
                    <Field
                      label={
                        ["PURCHASE", "CREATE_FUND", "UPDATE_SETTLEMENT"].includes(formAction)
                          ? "变更 / 差额原因（发生变更时必填）"
                          : formAction === "CORRECT_QUANTITY" ? "数量与单位核对依据（必填）" : "操作原因 / 说明"
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
                      {formAction === "BATCH_PAY" && <select aria-label={`${f.originalName} 关联范围`} value={fileTargets[f.id] || ""} onChange={e => setFileTargets(current => ({ ...current, [f.id]: e.target.value }))}>
                        <option value="">共用凭证 · 本批全部资金单</option>
                        {dialog.rows.map(r => <option key={r.id} value={r.id}>{r.number} · {r.name}</option>)}
                      </select>}
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
              <button disabled={busy || uploading} onClick={closeDialog}>
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
                disabled={busy || uploading || (formAction === 'CREATE_REIMBURSEMENT' && (accountLoading || !dialog.rows.length))}
                onClick={() => void submit()}
              >
                {busy
                  ? "保存中…"
                  : requestForm
                    ? "提交请购申请"
                    : formAction === 'CREATE_REIMBURSEMENT' ? '提交报销申请' : formAction === "BATCH_PAY" ? `确认登记 ${dialog.rows.length} 笔付款` : "确认" + (formAction === "PAY" ? "登记付款" : "保存")}
              </button>
            </footer>
          </div>
        </div>
      )}
      {confirmDiscard && (
        <PurchaseConfirm
          cancel={() => setConfirmDiscard(null)}
          confirm={() => {
            if (confirmDiscard === "form") setDialog(null);
            else setPushOpen(false);
            setConfirmDiscard(null);
          }}
        />
      )}
    </main>
  );
}
