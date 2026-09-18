import { createHash } from "node:crypto";
import {
  Prisma,
  type PcLine,
  type PcSettings,
  type PcFund,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createSystemNotification } from "@/lib/system-notifications";
import {
  PurchasingError,
  pcChoice,
  pcComplete,
  pcDate,
  pcFundingKey,
  pcIds,
  pcInt,
  pcRecord,
  pcSplit,
  pcText,
  pcVersion,
  type PcInput,
} from "@/lib/purchasing-domain";
type Tx = Prisma.TransactionClient;
export type PcActor = {
  id: string;
  username: string;
  displayName?: string | null;
  laborRole?: string;
};
const actorName = (a: PcActor) => a.displayName || a.username;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const lineInclude = {
  request: true,
  supplier: true,
  returns: true,
  allocations: { include: { fund: true } },
  balances: true,
  contractLines: { include: { contract: true } },
} satisfies Prisma.PcLineInclude;
type Line = Prisma.PcLineGetPayload<{
  include: typeof lineInclude;
}>;
const fundInclude = {
  allocations: { include: { line: { include: { request: true } } } },
  payments: true,
} satisfies Prisma.PcFundInclude;
type Fund = Prisma.PcFundGetPayload<{
  include: typeof fundInclude;
}>;
const conflict = (message: string): never => {
  throw new PurchasingError(message, "PURCHASING_CONFLICT", 409);
};
const denied = (message = "当前操作不在你的采购流程职责内"): never => {
  throw new PurchasingError(message, "PURCHASING_FORBIDDEN", 403);
};
const dateNow = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
const entries = (v: unknown) => {
  if (!Array.isArray(v) || !v.length || v.length > 100)
    throw new PurchasingError("请选择 1 至 100 项");
  const es = v.map(pcRecord);
  pcIds(es.map((e) => e.id));
  es.forEach((e) => pcInt(e.version, "记录版本"));
  return es;
};
async function serial(tx: Tx, prefix: string) {
  const day = dateNow().replaceAll("-", "");
  const s = await tx.pcSequence.upsert({
    where: { id: prefix + day },
    create: { id: prefix + day, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${prefix}${day}${String(s.value).padStart(5, "0")}`;
}
async function settings(tx: Tx) {
  const s = await tx.pcSettings.findUnique({ where: { id: "purchasing" } });
  if (!s)
    throw new PurchasingError(
      "请先在流程设置中选择审批、采购和财务负责人",
      "PURCHASING_SETUP",
      409,
    );
  return s;
}
function responsible(
  s: PcSettings,
  role: "purchaseApproverIds" | "fundApproverIds" | "financeIds" | "buyerIds",
  a: PcActor,
) {
  if (!s[role].includes(a.id)) denied();
}
async function activeUser(tx: Tx, id: unknown) {
  const user = await tx.user.findFirst({
    where: {
      id: pcText(id, "人员", 100),
      isActive: true,
      accountStatus: "ACTIVE",
    },
    select: { id: true, username: true, displayName: true },
  });
  if (!user) throw new PurchasingError("所选人员不存在或账号已停用");
  return { id: user.id, name: user.displayName || user.username };
}
async function event(
  tx: Tx,
  type: string,
  id: string,
  action: string,
  a: PcActor,
  snapshot: unknown,
  reason = "",
) {
  await tx.pcEvent.create({
    data: {
      entityType: type,
      entityId: id,
      action,
      actorId: a.id,
      actorName: actorName(a),
      snapshot: json(snapshot),
      reason,
    },
  });
}
async function notify(
  tx: Tx,
  type: string,
  id: string,
  version: number,
  title: string,
  users: string[],
  a: PcActor,
  view = "all",
) {
  const active = await tx.user.findMany({
    where: {
      id: { in: [...new Set(users)] },
      isActive: true,
      accountStatus: "ACTIVE",
    },
    select: { id: true },
  });
  await createSystemNotification(tx, {
    eventType: "PURCHASING_" + type,
    dedupeKey: `purchasing:${type}:${id}:${version}`,
    category: "TODO",
    title,
    sourceType: "PURCHASING",
    sourceId: id,
    actorId: a.id,
    targetRoute: `/workspace/purchases?view=${view}&record=${encodeURIComponent(id)}`,
    recipientUserIds: active.map((u) => u.id),
  });
}
async function closeTodo(tx: Tx, id: string) {
  await tx.systemNotificationRecipient.updateMany({
    where: {
      notification: { sourceType: "PURCHASING", sourceId: id },
      completedAt: null,
    },
    data: {
      completedAt: new Date(),
      completionKind: "PURCHASING_HANDLED",
      completionReason: "采购业务已推进到下一处理环节",
    },
  });
}
async function bindAttachments(
  tx: Tx,
  ids: unknown,
  type: string,
  id: string,
  a: PcActor,
) {
  if (ids === undefined || (Array.isArray(ids) && ids.length === 0)) return;
  const values = pcIds(ids, "附件");
  const files = await tx.pcAttachment.findMany({
    where: { id: { in: values }, deletedAt: null },
  });
  if (
    files.length !== values.length ||
    files.some(
      (f) =>
        !(
          (f.entityType === "STAGED" && f.actorId === a.id) ||
          (f.entityType === type && f.entityId === id)
        ),
    )
  )
    throw new PurchasingError("附件不存在、已被关联或不属于本次上传");
  await tx.pcAttachment.updateMany({
    where: { id: { in: values } },
    data: { entityType: type, entityId: id },
  });
}
async function getLine(tx: Tx, id: unknown, version?: unknown) {
  const p = await tx.pcLine.findUnique({
    where: { id: pcText(id, "采购明细", 100) },
    include: lineInclude,
  });
  if (!p || p.request.deletedAt)
    throw new PurchasingError("采购记录不存在", "PURCHASING_NOT_FOUND", 404);
  if (version !== undefined) pcVersion(p.version, version);
  return p;
}
async function getFund(tx: Tx, id: unknown, version?: unknown) {
  const f = await tx.pcFund.findUnique({
    where: { id: pcText(id, "资金单", 100) },
    include: fundInclude,
  });
  if (!f)
    throw new PurchasingError("资金单不存在", "PURCHASING_NOT_FOUND", 404);
  if (version !== undefined) pcVersion(f.version, version);
  return f;
}
async function refreshLine(tx: Tx, id: string) {
  const p = await getLine(tx, id);
  const refundOpen = sum(
    p.returns.map((r) => r.refundDueCents - r.companyReceivedCents),
  );
  const done = pcComplete({ ...p, refundOpen });
  if (done !== Boolean(p.completedAt))
    await tx.pcLine.update({
      where: { id },
      data: { completedAt: done ? new Date() : null },
    });
}
async function refreshRequest(tx: Tx, id: string) {
  const r = await tx.pcRequest.findUniqueOrThrow({
    where: { id },
    include: { lines: true },
  });
  const live = r.lines.filter((l) => l.status !== "VOID");
  const state = !live.length
    ? "VOID"
    : live.every((l) => l.status === "DRAFT")
      ? "DRAFT"
      : live.every((l) => l.status === "WITHDRAWN")
        ? "WITHDRAWN"
        : "SUBMITTED";
  await tx.pcRequest.update({
    where: { id },
    data: { status: state, version: { increment: 1 } },
  });
  if (!live.some((l) => l.status === "PENDING")) await closeTodo(tx, id);
}
function editableRequest(
  p: {
    submitterId: string;
    applicantId: string;
  },
  a: PcActor,
) {
  if (![p.submitterId, p.applicantId].includes(a.id))
    denied("只有申请人或提交人可以修改、撤回该申请");
}
function lineFields(v: PcInput, draft: boolean) {
  const quantity = pcInt(v.quantity ?? 1, "数量", 1, 1000000);
  const estimateCents = pcInt(
    v.estimateCents ?? 0,
    "预算合计（分）",
    draft ? 0 : 1,
  );
  const url = pcText(v.referenceUrl, "采购参考链接", 1000, false);
  if (url && !/^https?:\/\//i.test(url))
    throw new PurchasingError("参考链接须以 http:// 或 https:// 开头");
  return {
    name: pcText(v.name, "物品名称", 160, !draft),
    spec: pcText(v.spec, "规格型号", 200, !draft),
    unit: pcText(v.unit || "件", "单位", 30),
    quantity,
    estimateCents,
    category: pcText(v.category || "生产工具", "物品类型", 50),
    urgency: pcChoice(
      v.urgency || "NORMAL",
      ["NORMAL", "URGENT", "CRITICAL"],
      "紧急程度",
    ),
    needDate: pcDate(v.needDate || dateNow(), "需求日期"),
    referenceUrl: url,
  };
}
async function saveSettings(tx: Tx, input: PcInput, a: PcActor) {
  const old = await tx.pcSettings.findUnique({ where: { id: "purchasing" } });
  if (old) {
    if (old.ownerId !== a.id && a.laborRole !== "ADMIN")
      denied("只有流程配置维护人可以修改设置");
    pcVersion(old.version, input.version);
  }
  const values = {
    purchaseApproverIds: pcIds(input.purchaseApproverIds, "采购审批负责人"),
    fundApproverIds: pcIds(input.fundApproverIds, "资金审批负责人"),
    financeIds: pcIds(input.financeIds, "财务确认人"),
    buyerIds: pcIds(input.buyerIds, "采购经办人"),
  };
  for (const id of [...new Set(Object.values(values).flat())])
    await activeUser(tx, id);
  const owner = await activeUser(tx, input.ownerId || old?.ownerId || a.id);
  const result = await tx.pcSettings.upsert({
    where: { id: "purchasing" },
    create: { ...values, ownerId: owner.id },
    update: { ...values, ownerId: owner.id, version: { increment: 1 } },
  });
  await event(
    tx,
    "SETTINGS",
    result.id,
    "SAVE_SETTINGS",
    a,
    { before: old, after: result },
    pcText(input.reason, "设置变更原因", 500, !!old),
  );
  return { id: result.id, version: result.version };
}
async function saveRequest(tx: Tx, input: PcInput, a: PcActor) {
  const submit = input.submit === true;
  if (submit) await settings(tx);
  if (
    !Array.isArray(input.lines) ||
    !input.lines.length ||
    input.lines.length > 100
  )
    throw new PurchasingError("每次申请需包含 1 至 100 项物品");
  const es = input.lines.map(pcRecord);
  const existingIds = es.flatMap((e) => (e.id ? [e.id] : []));
  if (existingIds.length) pcIds(existingIds, "采购明细");
  const applicant = await activeUser(tx, input.applicantId || a.id);
  const purpose = pcText(input.purpose, "采购用途", 2000, submit);
  const workId = pcText(input.workOrderId, "关联工单", 100, false);
  const wo = workId
    ? await tx.workOrder.findUnique({
        where: { id: workId },
        select: { id: true, code: true },
      })
    : null;
  if (workId && !wo) throw new PurchasingError("关联工单不存在");
  let r = input.requestId
    ? await tx.pcRequest.findUnique({
        where: { id: pcText(input.requestId, "采购申请", 100) },
        include: { lines: true },
      })
    : null;
  if (input.requestId && !r) throw new PurchasingError("申请不存在");
  if (r) {
    editableRequest(r, a);
    pcVersion(r.version, input.version);
    if (r.deletedAt || r.status === "VOID") conflict("已作废申请不能修改");
    if (
      r.lines.some((l) => ["APPROVED", "ORDERED"].includes(l.status)) &&
      (r.purpose !== purpose ||
        r.applicantId !== applicant.id ||
        r.workOrderId !== (wo?.id || null))
    )
      conflict(
        "已通过明细的申请人、用途和关联工单不能覆盖，请仅修改退回的物品明细",
      );
    await tx.pcRequest.update({
      where: { id: r.id },
      data: {
        purpose,
        applicantId: applicant.id,
        applicantName: applicant.name,
        workOrderId: wo?.id || null,
        workOrderCode: wo?.code || "",
        version: { increment: 1 },
      },
    });
  } else {
    r = await tx.pcRequest.create({
      data: {
        number: await serial(tx, "CG"),
        applicantId: applicant.id,
        applicantName: applicant.name,
        submitterId: a.id,
        submitterName: actorName(a),
        purpose,
        workOrderId: wo?.id,
        workOrderCode: wo?.code || "",
      },
      include: { lines: true },
    });
  }
  const changed: string[] = [];
  let suffix = Math.max(
    0,
    ...r.lines.map((l) => Number(l.number.split("-").at(-1)) || 0),
  );
  for (const e of es) {
    const data = lineFields(e, !submit);
    if (e.id) {
      const p = r.lines.find((p) => p.id === e.id);
      if (!p) throw new PurchasingError("采购明细不存在");
      if (!["DRAFT", "RETURNED", "WITHDRAWN"].includes(p.status))
        conflict("仅草稿、已撤回或退回的明细可以修改");
      pcVersion(p.version, e.version);
      const next = await tx.pcLine.update({
        where: { id: p.id },
        data: {
          ...data,
          status: submit ? "PENDING" : "DRAFT",
          reason: "",
          version: { increment: 1 },
        },
      });
      await event(tx, "LINE", p.id, submit ? "RESUBMIT" : "SAVE_DRAFT", a, {
        before: p,
        after: next,
      });
      changed.push(p.id);
    } else {
      const p = await tx.pcLine.create({
        data: {
          ...data,
          requestId: r.id,
          number: `${r.number}-${String(++suffix).padStart(2, "0")}`,
          status: submit ? "PENDING" : "DRAFT",
        },
      });
      changed.push(p.id);
      await event(tx, "LINE", p.id, submit ? "SUBMIT" : "SAVE_DRAFT", a, p);
    }
  }
  if (input.replaceDraft === true && r.status === "DRAFT") {
    const removed = r.lines.filter((p) => !es.some((e) => e.id === p.id));
    for (const p of removed) {
      await tx.pcLine.update({
        where: { id: p.id },
        data: {
          status: "VOID",
          reason: "移除草稿明细",
          version: { increment: 1 },
        },
      });
      await event(tx, "LINE", p.id, "REMOVE_DRAFT_LINE", a, p);
    }
  }
  await bindAttachments(tx, input.attachmentIds, "REQUEST", r.id, a);
  await refreshRequest(tx, r.id);
  await event(tx, "REQUEST", r.id, submit ? "SUBMIT" : "SAVE_DRAFT", a, {
    lineIds: changed,
    purpose,
    applicant,
  });
  if (submit) {
    const s = await settings(tx);
    await notify(
      tx,
      "REQUEST",
      r.id,
      r.version + 1,
      `${applicant.name}提交采购申请 ${r.number}（${changed.length}项）`,
      s.purchaseApproverIds,
      a,
      "approval",
    );
  }
  const duplicates = submit
    ? await tx.pcLine.findMany({
        where: {
          id: { notIn: changed },
          name: { in: es.map((e) => String(e.name)) },
          status: { in: ["PENDING", "APPROVED", "ORDERED"] },
          completedAt: null,
          request: { applicantId: applicant.id },
          createdAt: { gte: new Date(Date.now() - 30 * 86400000) },
        },
        select: { id: true, number: true, name: true },
        take: 10,
      })
    : [];
  return { id: r.id, lineIds: changed, duplicates };
}
async function approveLines(tx: Tx, input: PcInput, a: PcActor) {
  const s = await settings(tx);
  responsible(s, "purchaseApproverIds", a);
  const es = entries(input.entries);
  const reject = input.action === "RETURN_LINES";
  const reason = pcText(input.reason, "退回原因", 1000, reject);
  const requests = new Set<string>();
  for (const e of es) {
    const p = await getLine(tx, e.id, e.version);
    if (p.status !== "PENDING") conflict(`${p.name}已不在待审批状态`);
    const after = await tx.pcLine.update({
      where: { id: p.id },
      data: {
        status: reject ? "RETURNED" : "APPROVED",
        reason,
        approvedById: reject ? null : a.id,
        approvedAt: reject ? null : new Date(),
        version: { increment: 1 },
      },
    });
    await event(
      tx,
      "LINE",
      p.id,
      reject ? "RETURN" : "APPROVE",
      a,
      { before: p, after },
      reason,
    );
    requests.add(p.requestId);
  }
  for (const id of requests) {
    await refreshRequest(tx, id);
    const r = await tx.pcRequest.findUniqueOrThrow({ where: { id } });
    await notify(
      tx,
      reject ? "RETURNED" : "APPROVED",
      id,
      r.version,
      reject ? `${r.number}有采购项退回修改` : `${r.number}采购审批通过`,
      reject ? [r.applicantId, r.submitterId] : s.buyerIds,
      a,
      reject ? "approval" : "execution",
    );
  }
  return { count: es.length };
}
async function withdrawLines(tx: Tx, input: PcInput, a: PcActor) {
  const es = entries(input.entries),
    reason = pcText(input.reason, "撤回 / 作废原因", 1000);
  const s = await settings(tx);
  for (const e of es) {
    const p = await getLine(tx, e.id, e.version);
    const voided = input.action === "VOID_LINES";
    if (voided) {
      if (
        ![p.request.applicantId, p.request.submitterId, ...s.buyerIds].includes(
          a.id,
        )
      )
        denied();
      if (
        p.receivedQty ||
        p.paidCents ||
        p.reservedCents ||
        p.invoiceCents ||
        p.returns.length
      )
        conflict("存在收货、资金或票据记录，须先完成业务冲销；不能直接作废");
    } else {
      editableRequest(p.request, a);
      if (!["DRAFT", "PENDING", "RETURNED"].includes(p.status))
        conflict("已批准或已采购的记录不能撤回申请");
    }
    const after = await tx.pcLine.update({
      where: { id: p.id },
      data: {
        status: voided ? "VOID" : "WITHDRAWN",
        reason,
        version: { increment: 1 },
      },
    });
    await event(
      tx,
      "LINE",
      p.id,
      String(input.action),
      a,
      { before: p, after },
      reason,
    );
    await refreshRequest(tx, p.requestId);
  }
  return { count: es.length };
}
async function createContract(tx: Tx, ps: Line[], input: PcInput, a: PcActor) {
  const number = pcText(input.contractNumber || input.number, "合同编号", 100);
  const previous = await tx.pcContract.findFirst({
    where: { number },
    orderBy: { revision: "desc" },
  });
  const snapshot = ps.map((p) => ({
    id: p.id,
    number: p.number,
    name: p.name,
    spec: p.spec,
    quantity: p.quantity,
    unit: p.unit,
    amountCents: p.actualCents || p.estimateCents,
  }));
  const contract = await tx.pcContract.create({
    data: {
      number,
      revision: (previous?.revision || 0) + 1,
      supplier: pcText(input.supplier || ps[0].supplier?.name, "供方", 200),
      purchaser: pcText(input.purchaser || "杭连电子", "需方", 200),
      terms: pcText(
        input.terms || "按双方确认的采购约定执行",
        "付款及交付约定",
        3000,
      ),
      taxNote: pcText(
        input.taxNote || "按双方确认的含税金额执行",
        "税率 / 含税口径",
        200,
      ),
      amountCents: sum(snapshot.map((p) => p.amountCents)),
      snapshot: json(snapshot),
      actorId: a.id,
      actorName: actorName(a),
      lines: {
        create: snapshot.map((p) => ({
          lineId: p.id,
          amountCents: p.amountCents,
        })),
      },
    },
  });
  await bindAttachments(
    tx,
    input.contractAttachmentIds || input.attachmentIds,
    "CONTRACT",
    contract.id,
    a,
  );
  await event(tx, "CONTRACT", contract.id, "CREATE", a, contract);
  return contract;
}
async function purchase(tx: Tx, input: PcInput, a: PcActor) {
  const s = await settings(tx);
  responsible(s, "buyerIds", a);
  const es = entries(input.entries),
    mode = pcChoice(
      input.settlement,
      ["CORPORATE", "ADVANCE", "MONTHLY"],
      "结算方式",
    ),
    supplierName = pcText(input.supplier, "供应商", 200);
  const payee = pcText(input.payee, "收款人", 200),
    bank = pcText(input.bank, "开户银行", 200),
    account = pcText(input.account, "收款账户", 120);
  const buyer = await activeUser(tx, input.buyerId || a.id);
  const payeeUser =
    mode === "ADVANCE" ? await activeUser(tx, input.payeeUserId) : null;
  const eta = pcDate(input.eta, "预计到货日期");
  const cycle = mode === "MONTHLY" ? pcText(input.cycle, "月结月份", 7) : "";
  if (cycle && !/^\d{4}-(0[1-9]|1[0-2])$/.test(cycle))
    throw new PurchasingError("月结月份无效");
  const dueDate = mode === "MONTHLY" ? pcDate(input.dueDate, "到期日期") : "";
  const supplier = await tx.pcSupplier.upsert({
    where: { name: supplierName },
    create: {
      name: supplierName,
      ...(mode !== "ADVANCE" ? { payee, bank, account } : {}),
    },
    update: mode !== "ADVANCE" ? { payee, bank, account } : {},
  });
  const updated: Line[] = [];
  for (const e of es) {
    const p = await getLine(tx, e.id, e.version),
      revision = p.status === "ORDERED";
    if (p.status !== "APPROVED" && !revision)
      conflict(`${p.name}尚未批准或已经作废`);
    if (
      revision &&
      (p.paidCents ||
        p.reservedCents ||
        p.receivedQty ||
        p.returns.length ||
        p.invoiceCents)
    )
      conflict(
        `${p.name}已有资金、收货或票据；先撤回未付款资金单，已执行事项通过退货或调整处理`,
      );
    const reason = pcText(input.reason, "采购修订原因", 1000, revision),
      actual = pcInt(e.actualCents, "实际采购总额（分）");
    if (actual >= 50000 && !input.contractNumber && !p.contractLines.length)
      throw new PurchasingError(`${p.name}单项总额达到 500 元，请填写合同编号`);
    let itemId = pcText(e.itemId || p.itemId, "关联物资", 100, false);
    if (itemId) {
      const material = await tx.pcItem.findUnique({ where: { id: itemId } });
      if (!material || material.unit !== p.unit || material.spec !== p.spec)
        throw new PurchasingError("关联物资的规格和单位须与采购明细一致");
    } else {
      const material = await tx.pcItem.create({
        data: {
          number: await serial(tx, "WZ"),
          name: p.name,
          spec: p.spec,
          unit: p.unit,
          category: p.category,
        },
      });
      itemId = material.id;
    }
    await tx.pcLine.update({
      where: { id: p.id },
      data: {
        status: "ORDERED",
        actualCents: actual,
        payableCents: actual,
        supplierId: supplier.id,
        settlement: mode,
        payee: payeeUser?.name || payee,
        payeeUserId: payeeUser?.id,
        bank,
        account,
        cycle,
        dueDate,
        eta,
        buyerId: buyer.id,
        buyerName: buyer.name,
        itemId,
        orderedAt: p.orderedAt || new Date(),
        version: { increment: 1 },
      },
    });
    const after = await getLine(tx, p.id);
    await event(
      tx,
      "LINE",
      p.id,
      revision ? "REVISE_PURCHASE" : "PURCHASE",
      a,
      { before: p, after },
      reason,
    );
    updated.push(after);
  }
  if (input.contractNumber) await createContract(tx, updated, input, a);
  await notify(
    tx,
    "PURCHASE",
    updated[0].requestId,
    updated[0].version,
    `${updated.length} 项采购已登记，可跟进收货与付款`,
    updated.map((p) => p.request.applicantId),
    a,
    "execution",
  );
  return { count: updated.length, ids: updated.map((p) => p.id) };
}
async function createFund(tx: Tx, input: PcInput, a: PcActor, offline = false) {
  const s = await settings(tx),
    ps: Line[] = [];
  for (const e of entries(input.entries)) {
    const p = await getLine(tx, e.id, e.version);
    if (p.status !== "ORDERED") conflict(`${p.name}尚未采购登记`);
    if (
      !offline &&
      ![
        ...s.buyerIds,
        p.request.applicantId,
        p.request.submitterId,
        p.payeeUserId,
      ].includes(a.id)
    )
      denied("仅采购经办、申请人或垫付人可发起资金申请");
    if (p.payableCents - p.reservedCents <= 0)
      conflict(`${p.name}没有可申请余额`);
    if (p.returns.some((r) => r.refundDueCents > r.companyReceivedCents))
      conflict("请先结清该采购的退款");
    ps.push(p);
  }
  if (new Set(ps.map(pcFundingKey)).size !== 1)
    throw new PurchasingError(
      "所选记录需拆分：同一资金单须同结算方式、收款人、账户和币种；对公还须同供应商，月结须同账期",
    );
  const first = ps[0],
    amount = pcInt(input.amountCents, "申请金额（分）"),
    available = ps.map((p) => p.payableCents - p.reservedCents),
    original = sum(available);
  pcInt(original, "本次明细合计");
  const adjustment = pcChoice(
    input.adjustment || "NONE",
    ["NONE", "PARTIAL", "DISCOUNT", "FREIGHT", "ROUNDING"],
    "差额类型",
  );
  const delta = amount - original;
  if (delta !== 0 && adjustment === "NONE")
    throw new PurchasingError("申请金额与明细合计不同，请选择差额类型");
  if (delta > 0 && !["FREIGHT", "ROUNDING"].includes(adjustment))
    throw new PurchasingError("超出明细合计的金额需选择运费或舍入调整");
  if (delta < 0 && adjustment === "FREIGHT")
    throw new PurchasingError("运费不能减少应付金额");
  if (adjustment === "ROUNDING" && Math.abs(delta) > 100)
    throw new PurchasingError("舍入调整不得超过 1 元，请选择其他明确差额类型");
  const payee = pcText(input.payee || first.payee, "收款人", 200),
    bank = pcText(input.bank || first.bank, "开户银行", 200),
    account = pcText(input.account || first.account, "收款账户", 120);
  const changed =
    payee !== first.payee || bank !== first.bank || account !== first.account;
  const reason = pcText(
    input.reason,
    "差额 / 收款信息变更原因",
    1000,
    delta !== 0 || changed || offline,
  );
  const shares = pcSplit(amount, available);
  if (shares.some((n) => n === 0))
    throw new PurchasingError("本次金额过小，部分明细分摊为零，请减少所选明细");
  const f = await tx.pcFund.create({
    data: {
      number: await serial(tx, first.settlement === "ADVANCE" ? "BX" : "FK"),
      status: offline ? "APPROVED" : "PENDING",
      settlement: first.settlement,
      supplierId: first.settlement === "ADVANCE" ? null : first.supplierId,
      payee,
      payeeUserId: first.payeeUserId,
      bank,
      account,
      currency: first.currency,
      cycle: first.cycle,
      dueDate: input.dueDate
        ? pcDate(input.dueDate, "期望付款日期")
        : first.dueDate,
      originalCents: original,
      amountCents: amount,
      adjustment,
      reason,
      accountChanged: changed,
      snapshot: json(
        ps.map((p, i) => ({
          lineId: p.id,
          number: p.number,
          name: p.name,
          supplier: p.supplier?.name,
          originalAvailableCents: available[i],
          allocationCents: shares[i],
          supplierId: p.supplierId,
          settlement: p.settlement,
          payee: p.payee,
          bank: p.bank,
          account: p.account,
        })),
      ),
      actorId: a.id,
      actorName: actorName(a),
      approvedById: offline ? a.id : null,
      approvedAt: offline ? new Date() : null,
      allocations: {
        create: ps.map((p, i) => ({ lineId: p.id, amountCents: shares[i] })),
      },
    },
  });
  for (const [i, p] of ps.entries()) {
    const difference = adjustment === "PARTIAL" ? 0 : shares[i] - available[i];
    pcInt(p.payableCents + difference, "采购应付金额", 0);
    await tx.pcLine.update({
      where: { id: p.id },
      data: {
        reservedCents: { increment: shares[i] },
        payableCents: { increment: difference },
        version: { increment: 1 },
      },
    });
    await event(
      tx,
      "LINE",
      p.id,
      offline ? "OFFLINE_FUND" : "CREATE_FUND",
      a,
      {
        fundId: f.id,
        fundNumber: f.number,
        amountCents: shares[i],
        payableAdjustment: difference,
      },
      reason,
    );
    await refreshLine(tx, p.id);
  }
  await bindAttachments(tx, input.attachmentIds, "FUND", f.id, a);
  await event(
    tx,
    "FUND",
    f.id,
    offline ? "OFFLINE_RECORD" : "SUBMIT",
    a,
    f,
    reason,
  );
  if (!offline)
    await notify(
      tx,
      "FUND",
      f.id,
      f.version,
      `${f.number} ${first.settlement === "ADVANCE" ? "报销" : "请款"}待审批`,
      s.fundApproverIds,
      a,
      "funds",
    );
  return { id: f.id, number: f.number, version: f.version };
}
async function changeFunds(tx: Tx, input: PcInput, a: PcActor) {
  const s = await settings(tx),
    action = String(input.action),
    es = input.entries
      ? entries(input.entries)
      : [{ id: input.id, version: pcInt(input.version, "资金单版本") }];
  const approve = action === "APPROVE_FUNDS";
  const reason = pcText(input.reason, "资金单处理原因", 1000, !approve);
  for (const e of es) {
    const f = await getFund(tx, e.id, e.version);
    if (approve) {
      responsible(s, "fundApproverIds", a);
      if (f.status !== "PENDING") conflict("该资金单已不在待审批状态");
      await tx.pcFund.update({
        where: { id: f.id },
        data: {
          status: "APPROVED",
          approvedById: a.id,
          approvedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await closeTodo(tx, f.id);
      await notify(
        tx,
        "FUND_APPROVED",
        f.id,
        f.version + 1,
        `${f.number}已批准，待财务打款`,
        s.financeIds,
        a,
        "finance",
      );
    } else {
      if (action === "RETURN_FUNDS") responsible(s, "fundApproverIds", a);
      else if (action === "CLOSE_FUND") responsible(s, "financeIds", a);
      else if (f.actorId !== a.id && !s.fundApproverIds.includes(a.id))
        denied("仅资金申请人或资金审批负责人可撤回");
      if (!["PENDING", "APPROVED", "PARTIAL"].includes(f.status))
        conflict("该资金单不能重复退回、撤回或关闭");
      if (f.paidCents && action !== "CLOSE_FUND")
        conflict("已有实际付款，请由财务关闭未支付余额，已付事实会保留");
      if (action === "CLOSE_FUND" && f.paidCents >= f.amountCents)
        conflict("已付清资金单无需关闭");
      for (const al of f.allocations) {
        const released = al.amountCents - al.paidCents;
        await tx.pcLine.update({
          where: { id: al.lineId },
          data: {
            reservedCents: { decrement: released },
            version: { increment: 1 },
          },
        });
        await tx.pcFundAllocation.update({
          where: { id: al.id },
          data: al.paidCents
            ? { amountCents: al.paidCents }
            : { active: false },
        });
        await event(
          tx,
          "LINE",
          al.lineId,
          action,
          a,
          { fundId: f.id, releasedCents: released },
          reason,
        );
        await refreshLine(tx, al.lineId);
      }
      await tx.pcFund.update({
        where: { id: f.id },
        data: {
          status:
            action === "RETURN_FUNDS"
              ? "RETURNED"
              : action === "CLOSE_FUND"
                ? "CLOSED"
                : "WITHDRAWN",
          ...(action === "CLOSE_FUND" ? { amountCents: f.paidCents } : {}),
          reason,
          version: { increment: 1 },
        },
      });
      await closeTodo(tx, f.id);
      await notify(
        tx,
        "FUND_CHANGED",
        f.id,
        f.version + 1,
        `${f.number}已${action === "RETURN_FUNDS" ? "退回" : action === "CLOSE_FUND" ? "关闭未付余额" : "撤回"}，可调整后重新申请`,
        [f.actorId],
        a,
        "execution",
      );
    }
    await event(
      tx,
      "FUND",
      f.id,
      action,
      a,
      { before: f, after: await getFund(tx, f.id) },
      reason,
    );
  }
  return { count: es.length };
}
async function pay(tx: Tx, input: PcInput, a: PcActor) {
  const s = await settings(tx);
  responsible(s, "financeIds", a);
  const f = await getFund(tx, input.id, pcInt(input.version, "资金单版本"));
  if (!["APPROVED", "PARTIAL"].includes(f.status))
    conflict("只能登记已经批准的资金单");
  const amount = pcInt(input.amountCents, "本次付款金额（分）");
  if (amount > f.amountCents - f.paidCents)
    conflict("付款金额超过已批准的剩余金额");
  const date = pcDate(input.date, "付款日期");
  if (date > dateNow()) throw new PurchasingError("实际付款日期不能晚于今天");
  const reference = pcText(input.reference, "银行流水号", 200),
    source = pcText(input.source, "付款账户", 200);
  const payment = await tx.pcPayment.create({
    data: {
      fundId: f.id,
      amountCents: amount,
      date,
      reference,
      source,
      actorId: a.id,
      actorName: actorName(a),
    },
  });
  const allocations = pcSplit(
    amount,
    f.allocations.map((al) => al.amountCents - al.paidCents),
  );
  for (const [i, al] of f.allocations.entries()) {
    const delta = allocations[i];
    await tx.pcFundAllocation.update({
      where: { id: al.id },
      data: { paidCents: al.paidCents + delta },
    });
    await tx.pcLine.update({
      where: { id: al.lineId },
      data: { paidCents: { increment: delta }, version: { increment: 1 } },
    });
    await event(tx, "LINE", al.lineId, "PAY", a, {
      fundId: f.id,
      paymentId: payment.id,
      amountCents: delta,
    });
    await refreshLine(tx, al.lineId);
  }
  const paid = f.paidCents + amount;
  await tx.pcFund.update({
    where: { id: f.id },
    data: {
      paidCents: paid,
      status: paid === f.amountCents ? "PAID" : "PARTIAL",
      version: { increment: 1 },
    },
  });
  await bindAttachments(tx, input.attachmentIds, "PAYMENT", payment.id, a);
  await event(tx, "FUND", f.id, "PAY", a, payment);
  if (paid === f.amountCents) await closeTodo(tx, f.id);
  return { id: payment.id, remainingCents: f.amountCents - paid };
}
async function offlinePayment(tx: Tx, input: PcInput, a: PcActor) {
  const s = await settings(tx);
  responsible(s, "financeIds", a);
  if (input.fundId) return pay(tx, { ...input, id: input.fundId }, a);
  for (const e of entries(input.entries)) {
    const p = await getLine(tx, e.id, e.version);
    if (
      p.allocations.some(
        (al) =>
          al.active &&
          ["PENDING", "APPROVED", "PARTIAL"].includes(al.fund.status),
      )
    )
      conflict("已有未结束资金单，请在原资金单登记，不能重复补录");
  }
  const f = await createFund(
    tx,
    { ...input, adjustment: input.adjustment || "PARTIAL" },
    a,
    true,
  );
  return pay(tx, { ...input, id: f.id, version: f.version }, a);
}
async function ledger(
  tx: Tx,
  stock: {
    id: string;
    lineId: string;
    onHand: number;
    issued: number;
  },
  kind: string,
  quantity: number,
  sourceId: string,
  reason: string,
  person: string,
  a: PcActor,
  issuedChange = 0,
) {
  const balance = stock.onHand + quantity,
    issued = stock.issued + issuedChange;
  if (balance < 0 || issued < 0)
    conflict("数量超过当前在库或已领用数量，请刷新核对");
  pcInt(balance, "结余数量", 0);
  pcInt(issued, "领用数量", 0);
  await tx.pcStockBalance.update({
    where: { id: stock.id },
    data: { onHand: balance, issued, version: { increment: 1 } },
  });
  await tx.pcStockMovement.create({
    data: {
      stockId: stock.id,
      lineId: stock.lineId,
      kind,
      quantity,
      balance,
      sourceId,
      reason,
      person,
      actorId: a.id,
      actorName: actorName(a),
    },
  });
}
async function receive(tx: Tx, input: PcInput, a: PcActor) {
  const es = entries(input.entries),
    date = pcDate(input.date, "收货日期");
  if (date > dateNow()) throw new PurchasingError("实际收货日期不能晚于今天");
  const receiver = await activeUser(tx, input.receiverId || a.id),
    warehouse = pcText(input.warehouse, "仓库", 100),
    location = pcText(input.location, "库位", 100),
    number = await serial(tx, "RK");
  for (const e of es) {
    const p = await getLine(tx, e.id, e.version),
      q = pcInt(e.quantity, "本次收货数量", 1, 1000000);
    if (p.status !== "ORDERED" || !p.itemId) conflict("须先登记采购后收货");
    if (q > p.quantity - p.receivedQty - p.cancelledQty)
      conflict(`${p.name}收货数量超过剩余待收数量`);
    const stock = await tx.pcStockBalance.upsert({
      where: {
        lineId_warehouse_location: { lineId: p.id, warehouse, location },
      },
      create: { lineId: p.id, itemId: p.itemId!, warehouse, location },
      update: {},
    });
    const r = await tx.pcReceipt.create({
      data: {
        number,
        lineId: p.id,
        stockId: stock.id,
        quantity: q,
        date,
        receiverId: receiver.id,
        receiver: receiver.name,
        actorId: a.id,
      },
    });
    await ledger(tx, stock, "RECEIVE", q, r.id, "采购收货", receiver.name, a);
    await tx.pcLine.update({
      where: { id: p.id },
      data: { receivedQty: { increment: q }, version: { increment: 1 } },
    });
    await event(tx, "LINE", p.id, "RECEIVE", a, {
      receipt: r,
      warehouse,
      location,
    });
    await refreshLine(tx, p.id);
  }
  return { number, count: es.length };
}
async function stockMove(tx: Tx, input: PcInput, a: PcActor) {
  const stock = await tx.pcStockBalance.findUnique({
    where: { id: pcText(input.id, "库存记录", 100) },
  });
  if (!stock) throw new PurchasingError("库存记录不存在");
  pcVersion(stock.version, input.version);
  const quantity = pcInt(input.quantity, "数量", 1, 1000000),
    reason = pcText(input.reason, "操作原因", 1000),
    person = pcText(
      input.person,
      "领用 / 归还人",
      100,
      input.action !== "ADJUST_STOCK",
    );
  let delta = 0,
    issued = 0;
  if (input.action === "ISSUE") {
    delta = -quantity;
    issued = quantity;
  } else if (input.action === "RESTOCK") {
    delta = quantity;
    issued = -quantity;
  } else {
    const s = await settings(tx);
    responsible(s, "buyerIds", a);
    delta =
      pcChoice(input.direction, ["IN", "OUT"], "调整方向") === "IN"
        ? quantity
        : -quantity;
  }
  await ledger(
    tx,
    stock,
    String(input.action),
    delta,
    stock.id,
    reason,
    person,
    a,
    issued,
  );
  await event(
    tx,
    "LINE",
    stock.lineId,
    String(input.action),
    a,
    { stockId: stock.id, quantity: delta, person },
    reason,
  );
  return { id: stock.id };
}
async function returnGoods(tx: Tx, input: PcInput, a: PcActor) {
  const p = await getLine(tx, input.id, pcInt(input.version, "采购记录版本"));
  if (p.status !== "ORDERED") conflict("只有已采购记录可以办理退货");
  if (
    p.allocations.some(
      (al) =>
        al.active &&
        ["PENDING", "APPROVED", "PARTIAL"].includes(al.fund.status),
    )
  )
    conflict(
      "请先在关联资金单撤回未付款申请；部分付款由财务关闭未付余额，再办理退货",
    );
  const kind = pcChoice(input.kind, ["STOCK", "UNRECEIVED"], "退货类型"),
    q = pcInt(input.quantity, "退货数量", 1, 1000000),
    amount = pcInt(input.amountCents, "退货冲减金额（分）"),
    reason = pcText(input.reason, "退货原因", 1000),
    date = pcDate(input.date, "退货日期");
  if (date > dateNow()) throw new PurchasingError("实际退货日期不能晚于今天");
  if (amount > p.payableCents) conflict("退货金额超过剩余采购应付金额");
  const leftQuantity = p.quantity - p.returnedQty - p.cancelledQty;
  if (q > leftQuantity) conflict("退货数量超过有效采购数量");
  if (q === leftQuantity && amount !== p.payableCents)
    throw new PurchasingError("全部退货须冲减全部剩余采购金额");
  if (q < leftQuantity && amount >= p.payableCents)
    throw new PurchasingError("部分退货须为保留物品留下采购金额");
  let stock = null;
  if (kind === "STOCK") {
    stock = await tx.pcStockBalance.findUnique({
      where: { id: pcText(input.stockId, "退货库位", 100) },
    });
    if (!stock || stock.lineId !== p.id)
      throw new PurchasingError("退货库存与采购明细不匹配");
    pcVersion(stock.version, input.stockVersion);
    if (q > stock.onHand || q > p.receivedQty - p.returnedQty)
      conflict("退货数量超过可退在库数量；已领用物品须先退库");
  } else if (q > p.quantity - p.receivedQty - p.cancelledQty)
    conflict("未入库退货数量超过待收数量");
  if (p.settlement === "ADVANCE" && p.paidCents > 0 && kind !== "STOCK")
    conflict("已报销采购必须先有入库记录，再从在库数量办理退货");
  const nextPayable = p.payableCents - amount;
  const priorRefundOutstanding = sum(
    p.returns.map((r) => r.refundDueCents - r.companyReceivedCents),
  );
  const refundDue = Math.max(
    0,
    p.paidCents - p.refundedCents - nextPayable - priorRefundOutstanding,
  );
  const r = await tx.pcReturn.create({
    data: {
      number: await serial(tx, "TH"),
      lineId: p.id,
      stockId: stock?.id,
      kind,
      quantity: q,
      amountCents: amount,
      refundDueCents: refundDue,
      reason,
      date,
      destination: pcText(input.destination || "公司账户", "退款去向", 200),
      actorId: a.id,
      actorName: actorName(a),
    },
  });
  if (stock)
    await ledger(tx, stock, "SUPPLIER_RETURN", -q, r.id, reason, "", a);
  await tx.pcLine.update({
    where: { id: p.id },
    data: {
      payableCents: nextPayable,
      returnedQty: { increment: kind === "STOCK" ? q : 0 },
      cancelledQty: { increment: kind === "UNRECEIVED" ? q : 0 },
      version: { increment: 1 },
    },
  });
  await event(tx, "LINE", p.id, "RETURN_GOODS", a, r, reason);
  if (refundDue) {
    const s = await settings(tx);
    await notify(
      tx,
      "REFUND",
      r.id,
      1,
      `${r.number}待退款`,
      s.financeIds,
      a,
      "documents",
    );
  }
  await refreshLine(tx, p.id);
  return { id: r.id, number: r.number, refundDueCents: refundDue };
}
async function refund(tx: Tx, input: PcInput, a: PcActor) {
  const s = await settings(tx);
  responsible(s, "financeIds", a);
  const r = await tx.pcReturn.findUnique({
    where: { id: pcText(input.id, "退货单", 100) },
  });
  if (!r) throw new PurchasingError("退货单不存在");
  pcVersion(r.version, input.version);
  const amount = pcInt(input.amountCents, "本次到账金额（分）"),
    handover = input.action === "REFUND_HANDOVER",
    destination = handover
      ? "COMPANY"
      : pcChoice(input.destination, ["COMPANY", "PERSON"], "退款到账对象"),
    date = pcDate(input.date, "到账日期"),
    reference = pcText(input.reference, "到账凭证 / 流水", 200);
  if (date > dateNow()) throw new PurchasingError("实际到账日期不能晚于今天");
  if (
    handover
      ? amount > r.refundedCents - r.companyReceivedCents
      : amount > r.refundDueCents - r.refundedCents
  )
    conflict("退款金额超过待到账或待归还金额");
  const company = destination === "COMPANY" ? amount : 0;
  const row = await tx.pcRefund.create({
    data: {
      returnId: r.id,
      amountCents: amount,
      kind: handover ? "HANDOVER" : "SUPPLIER",
      destination,
      date,
      reference,
      actorId: a.id,
      actorName: actorName(a),
    },
  });
  const updated = await tx.pcReturn.update({
    where: { id: r.id },
    data: {
      refundedCents: { increment: handover ? 0 : amount },
      companyReceivedCents: { increment: company },
      version: { increment: 1 },
    },
  });
  await tx.pcLine.update({
    where: { id: r.lineId },
    data: { refundedCents: { increment: company }, version: { increment: 1 } },
  });
  await bindAttachments(tx, input.attachmentIds, "REFUND", row.id, a);
  await event(
    tx,
    "LINE",
    r.lineId,
    handover ? "REFUND_HANDOVER" : "REFUND",
    a,
    row,
  );
  if (updated.companyReceivedCents === updated.refundDueCents)
    await closeTodo(tx, r.id);
  await refreshLine(tx, r.lineId);
  return {
    id: row.id,
    remainingCents: updated.refundDueCents - updated.companyReceivedCents,
  };
}
async function invoice(tx: Tx, input: PcInput, a: PcActor) {
  const es = entries(input.entries),
    ps: Line[] = [];
  for (const e of es) {
    const p = await getLine(tx, e.id, e.version);
    if (p.status !== "ORDERED") conflict("发票仅可关联已采购明细");
    ps.push(p);
  }
  if (new Set(ps.map((p) => p.supplierId)).size !== 1)
    throw new PurchasingError("一张发票仅可关联同一供应商");
  const kind = pcChoice(
      input.kind || "NORMAL",
      ["NORMAL", "CREDIT"],
      "发票类型",
    ),
    sign = kind === "CREDIT" ? -1 : 1,
    due = ps.map((p) => (p.payableCents - p.invoiceCents) * sign);
  if (due.some((n) => n <= 0))
    throw new PurchasingError("所选采购没有对应类型的待处理发票金额");
  const amount = pcInt(input.amountCents, "发票关联金额（分）");
  if (amount > sum(due))
    throw new PurchasingError("本次关联金额超过待处理总额");
  const fileIds = pcIds(input.attachmentIds, "发票附件");
  const no = pcText(input.number, "发票号码", 100);
  if (await tx.pcInvoice.findUnique({ where: { number: no } }))
    throw new PurchasingError("该发票号码已经登记");
  const shares = pcSplit(amount, due);
  const row = await tx.pcInvoice.create({
    data: {
      number: no,
      supplierId: ps[0].supplierId!,
      kind,
      amountCents: amount * sign,
      date: pcDate(input.date, "开票日期"),
      actorId: a.id,
      actorName: actorName(a),
      lines: {
        create: ps.map((p, i) => ({
          lineId: p.id,
          amountCents: shares[i] * sign,
        })),
      },
    },
  });
  await bindAttachments(tx, fileIds, "INVOICE", row.id, a);
  for (const [i, p] of ps.entries()) {
    await tx.pcLine.update({
      where: { id: p.id },
      data: {
        invoiceCents: { increment: shares[i] * sign },
        version: { increment: 1 },
      },
    });
    await event(tx, "LINE", p.id, "INVOICE", a, {
      invoiceId: row.id,
      number: no,
      kind,
      amountCents: shares[i] * sign,
    });
    await refreshLine(tx, p.id);
  }
  return { id: row.id };
}
export async function mutatePurchasing(
  input: PcInput,
  a: PcActor,
  key: unknown,
) {
  const operationKey = pcText(key, "操作标识", 160),
    hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return prisma.$transaction(
    async (tx) => {
      // A module-wide transaction lock covers batches across funds, receipts and stock.
      // Version checks still reject stale clients after waiting for a concurrent writer.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('hongmeng-purchasing-v1',0))`;
      const done = await tx.pcOperation.findUnique({
        where: { id: operationKey },
      });
      if (done) {
        if (done.actorId !== a.id || done.payloadHash !== hash)
          conflict("同一操作标识不能用于不同请求");
        return done.result;
      }
      let result: unknown;
      const action = pcText(input.action, "操作类型", 60);
      if (action === "SAVE_SETTINGS") result = await saveSettings(tx, input, a);
      else if (action === "SAVE_REQUEST")
        result = await saveRequest(tx, input, a);
      else if (["APPROVE_LINES", "RETURN_LINES"].includes(action))
        result = await approveLines(tx, input, a);
      else if (["WITHDRAW_LINES", "VOID_LINES"].includes(action))
        result = await withdrawLines(tx, input, a);
      else if (action === "PURCHASE") result = await purchase(tx, input, a);
      else if (action === "CREATE_FUND")
        result = await createFund(tx, input, a);
      else if (
        [
          "APPROVE_FUNDS",
          "RETURN_FUNDS",
          "WITHDRAW_FUND",
          "CLOSE_FUND",
        ].includes(action)
      )
        result = await changeFunds(tx, input, a);
      else if (action === "PAY") result = await pay(tx, input, a);
      else if (action === "OFFLINE_PAYMENT")
        result = await offlinePayment(tx, input, a);
      else if (action === "RECEIVE") result = await receive(tx, input, a);
      else if (["ISSUE", "RESTOCK", "ADJUST_STOCK"].includes(action))
        result = await stockMove(tx, input, a);
      else if (action === "RETURN_GOODS")
        result = await returnGoods(tx, input, a);
      else if (["REFUND", "REFUND_HANDOVER"].includes(action))
        result = await refund(tx, input, a);
      else if (action === "INVOICE") result = await invoice(tx, input, a);
      else if (action === "CONTRACT") {
        const s = await settings(tx);
        responsible(s, "buyerIds", a);
        const ps: Line[] = [];
        for (const e of entries(input.entries))
          ps.push(await getLine(tx, e.id, e.version));
        if (ps.some((p) => !["APPROVED", "ORDERED"].includes(p.status)))
          conflict("合同仅能关联已批准的采购");
        if (
          new Set(ps.map((p) => p.supplierId || String(input.supplier)))
            .size !== 1
        )
          throw new PurchasingError("合并合同须为同一供应商");
        const c = await createContract(tx, ps, input, a);
        result = { id: c.id, number: c.number };
      } else if (action === "NOTE") {
        const p = await getLine(
          tx,
          input.id,
          pcInt(input.version, "采购记录版本"),
        );
        const note = pcText(input.note, "备注", 2000, false);
        await tx.pcLine.update({
          where: { id: p.id },
          data: { note, version: { increment: 1 } },
        });
        await event(tx, "LINE", p.id, "NOTE", a, {
          before: p.note,
          after: note,
        });
        result = { id: p.id };
      } else if (action === "ATTACH_FILES") {
        const p = await getLine(
          tx,
          input.id,
          pcInt(input.version, "采购记录版本"),
        );
        const reason = pcText(input.reason, "补充说明", 1000);
        pcIds(input.attachmentIds, "附件");
        await bindAttachments(tx, input.attachmentIds, "LINE", p.id, a);
        await tx.pcLine.update({
          where: { id: p.id },
          data: { version: { increment: 1 } },
        });
        await event(
          tx,
          "LINE",
          p.id,
          "ATTACH_FILES",
          a,
          { attachmentIds: input.attachmentIds },
          reason,
        );
        result = { id: p.id };
      } else if (action === "DELETE_ATTACHMENT") {
        const f = await tx.pcAttachment.findFirst({
          where: { id: pcText(input.id, "附件", 100), deletedAt: null },
        });
        if (!f) throw new PurchasingError("附件不存在");
        if (f.entityType !== "STAGED")
          throw new PurchasingError(
            "已关联业务的凭证不可删除；请补充新附件并保留原记录",
          );
        if (f.actorId !== a.id) denied();
        await tx.pcAttachment.update({
          where: { id: f.id },
          data: {
            deletedAt: new Date(),
            deleteReason: pcText(input.reason, "移除原因", 500),
          },
        });
        result = { id: f.id };
      } else throw new PurchasingError("不支持的采购操作");
      const saved = json(result);
      await tx.pcOperation.create({
        data: {
          id: operationKey,
          actorId: a.id,
          payloadHash: hash,
          result: saved,
        },
      });
      return saved;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 15000,
      timeout: 45000,
    },
  );
}
