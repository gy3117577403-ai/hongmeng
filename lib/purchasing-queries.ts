import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  PC_VIEWS,
  PurchasingError,
  pcDate,
  pcMask,
  type PcRow,
  type PcWorkbench,
} from "@/lib/purchasing-domain";
import type { PcActor } from "@/lib/purchasing-service";
export type PcQuery = {
  view?: string;
  task?: string;
  lineTask?: Prisma.PcLineWhereInput;
  fundTask?: Prisma.PcFundWhereInput;
  q?: string;
  urgency?: string;
  settlement?: string;
  supplierId?: string;
  from?: string;
  to?: string;
  mine?: boolean;
  follow?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  ids?: string[];
};
const include = {
  request: true,
  supplier: true,
  returns: true,
  item: true,
} satisfies Prisma.PcLineInclude;
type Line = Prisma.PcLineGetPayload<{
  include: typeof include;
}>;
type Plain<T> = T extends Date
  ? string
  : T extends Array<infer U>
    ? Plain<U>[]
    : T extends object
      ? {
          [K in keyof T]: Plain<T[K]>;
        }
      : T;
const plain = <T>(v: T): Plain<T> => JSON.parse(JSON.stringify(v));
export function pcLineRow(p: Line): PcRow {
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
    account: pcMask(p.account),
    needDate: p.needDate,
    urgency: p.urgency,
    receivedQty: p.receivedQty,
    cancelledQty: p.cancelledQty,
    returnedQty: p.returnedQty,
    availableCents: Math.max(0, p.payableCents - p.reservedCents),
    paidCents: p.paidCents - p.refundedCents,
    invoiceCents: p.invoiceCents,
    refundOpen: p.returns.reduce(
      (s, r) => s + r.refundDueCents - r.companyReceivedCents,
      0,
    ),
    completed: !!p.completedAt,
    createdAt: p.createdAt.toISOString(),
    requestId: p.requestId,
    purpose: p.request.purpose,
    eta: p.eta,
    itemNumber: p.item?.number || "",
  };
}
function lineWhere(
  q: PcQuery,
  a: PcActor,
  view = q.view || "all",
): Prisma.PcLineWhereInput {
  const and: Prisma.PcLineWhereInput[] = [{ request: { deletedAt: null } }];
  if (q.lineTask) and.push(q.lineTask);
  if (view === "drafts")
    and.push({
      status: "DRAFT",
      request: { OR: [{ applicantId: a.id }, { submitterId: a.id }] },
    });
  else
    and.push({
      status: q.follow === "void" ? "VOID" : { notIn: ["DRAFT", "VOID"] },
    });
  if (view === "approval")
    and.push({ status: { in: ["PENDING", "RETURNED", "WITHDRAWN"] } });
  if (view === "execution")
    and.push({ status: { in: ["APPROVED", "ORDERED"] }, completedAt: null });
  if (view === "completed") and.push({ completedAt: { not: null } });
  const refunds: Prisma.PcLineWhereInput = {
    returns: {
      some: {
        refundDueCents: { gt: prisma.pcReturn.fields.companyReceivedCents },
      },
    },
  };
  const invoices: Prisma.PcLineWhereInput = {
    status: "ORDERED",
    NOT: { invoiceCents: { equals: prisma.pcLine.fields.payableCents } },
  };
  if (view === "documents")
    and.push({ status: "ORDERED", OR: [refunds, invoices] });
  if (q.follow === "refund") and.push(refunds);
  if (q.follow === "invoice") and.push(invoices);
  if (q.follow === "unpaid")
    and.push({
      status: "ORDERED",
      paidCents: { lt: prisma.pcLine.fields.payableCents },
    });
  if (q.q) {
    const contains = q.q.trim().slice(0, 200);
    and.push({
      OR: [
        { name: { contains, mode: "insensitive" } },
        { number: { contains, mode: "insensitive" } },
        { spec: { contains, mode: "insensitive" } },
        { request: { applicantName: { contains, mode: "insensitive" } } },
        { supplier: { name: { contains, mode: "insensitive" } } },
      ],
    });
  }
  if (q.urgency) and.push({ urgency: q.urgency });
  if (q.supplierId) and.push({ supplierId: q.supplierId });
  if (q.settlement) and.push({ settlement: q.settlement });
  if (q.from)
    and.push({
      createdAt: { gte: new Date(pcDate(q.from) + "T00:00:00+08:00") },
    });
  if (q.to)
    and.push({
      createdAt: {
        lt: new Date(
          new Date(pcDate(q.to) + "T00:00:00+08:00").getTime() + 86400000,
        ),
      },
    });
  if (q.mine)
    and.push({
      completedAt: null,
      OR: [
        { request: { applicantId: a.id } },
        { buyerId: a.id },
        { payeeUserId: a.id },
      ],
    });
  if (q.ids?.length) and.push({ id: { in: q.ids } });
  return { AND: and };
}
function fundWhere(
  q: PcQuery,
  a: PcActor,
  view = q.view,
): Prisma.PcFundWhereInput {
  const where: Prisma.PcFundWhereInput = {};
  if (q.fundTask) where.AND = [q.fundTask];
  if (q.follow !== "history")
    where.status =
      view === "finance" ? { in: ["APPROVED", "PARTIAL"] } : "PENDING";
  if (q.ids?.length) where.id = { in: q.ids };
  if (q.settlement) where.settlement = q.settlement;
  if (q.supplierId)
    where.allocations = { some: { line: { supplierId: q.supplierId } } };
  if (q.q)
    where.OR = [
      { number: { contains: q.q, mode: "insensitive" } },
      { payee: { contains: q.q, mode: "insensitive" } },
      {
        allocations: {
          some: { line: { name: { contains: q.q, mode: "insensitive" } } },
        },
      },
    ];
  const and: Prisma.PcFundWhereInput[] = [];
  if (q.mine) and.push({ OR: [{ actorId: a.id }, { payeeUserId: a.id }] });
  if (q.urgency)
    and.push({ allocations: { some: { line: { urgency: q.urgency } } } });
  if (and.length)
    where.AND = [...(Array.isArray(where.AND) ? where.AND : []), ...and];
  if (q.from || q.to)
    where.createdAt = {
      ...(q.from ? { gte: new Date(pcDate(q.from) + "T00:00:00+08:00") } : {}),
      ...(q.to
        ? {
            lt: new Date(
              new Date(pcDate(q.to) + "T00:00:00+08:00").getTime() + 86400000,
            ),
          }
        : {}),
    };
  return where;
}
export async function loadPurchasing(
  q: PcQuery,
  a: PcActor,
): Promise<PcWorkbench> {
  const page = Math.max(1, Math.floor(q.page || 1)),
    pageSize = Math.max(1, Math.min(10000, Math.floor(q.pageSize || 12)));
  const view = q.view || "all";
  if (!PC_VIEWS.some((v) => v.id === view))
    throw new PurchasingError("采购视图无效");
  const [settings, users, suppliers] = await Promise.all([
    prisma.pcSettings.findUnique({ where: { id: "purchasing" } }),
    prisma.user.findMany({
      where: { isActive: true, accountStatus: "ACTIVE" },
      select: { id: true, displayName: true, username: true },
      orderBy: { displayName: "asc" },
    }),
    prisma.pcSupplier.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  q = { ...q, ...purchasingTaskFilters(q.task, a.id, settings) };
  const permission = (
    key: "purchaseApproverIds" | "fundApproverIds" | "financeIds" | "buyerIds",
  ) => settings?.[key].includes(a.id) || false;
  const permissions = {
    configure:
      !settings || settings.ownerId === a.id || a.laborRole === "ADMIN",
    approvePurchase: permission("purchaseApproverIds"),
    approveFund: permission("fundApproverIds"),
    finance: permission("financeIds"),
    buy: permission("buyerIds"),
  };
  let rows: PcRow[] = [],
    total = 0,
    totalCents = 0;
  if (["funds", "finance"].includes(view)) {
    const where = fundWhere(q, a),
      [fs, count, agg] = await Promise.all([
        prisma.pcFund.findMany({
          where,
          include: { allocations: { include: { line: true } } },
          orderBy:
            q.sort === "amount"
              ? { amountCents: "desc" }
              : { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.pcFund.count({ where }),
        prisma.pcFund.aggregate({
          where,
          _sum: { amountCents: true, paidCents: true },
        }),
      ]);
    total = count;
    totalCents =
      (agg._sum.amountCents || 0) -
      (view === "finance" ? agg._sum.paidCents || 0 : 0);
    rows = fs.map((f) => ({
      id: f.id,
      kind: "fund",
      number: f.number,
      version: f.version,
      name: f.payee,
      spec: `${f.allocations.length} 项 · ${f.allocations.map((x) => x.line.name).join("、")}`,
      quantity: f.allocations.length,
      unit: "项",
      amountCents: f.amountCents,
      status: f.status,
      applicantName: f.actorName,
      supplier: "",
      settlement: f.settlement,
      payee: f.payee,
      account: pcMask(f.account),
      needDate: f.dueDate,
      urgency: "NORMAL",
      receivedQty: 0,
      cancelledQty: 0,
      returnedQty: 0,
      availableCents: f.amountCents - f.paidCents,
      paidCents: f.paidCents,
      invoiceCents: 0,
      refundOpen: 0,
      completed: f.status === "PAID",
      createdAt: f.createdAt.toISOString(),
      requestId: "",
      purpose: f.reason,
      eta: "",
    }));
  } else if (view === "stock") {
    const where: Prisma.PcStockBalanceWhereInput = {
      ...(q.ids?.length ? { id: { in: q.ids } } : {}),
      ...(q.q
        ? {
            OR: [
              { item: { name: { contains: q.q, mode: "insensitive" } } },
              { item: { number: { contains: q.q, mode: "insensitive" } } },
              { warehouse: { contains: q.q } },
              { location: { contains: q.q } },
            ],
          }
        : {}),
    };
    const [stocks, count] = await Promise.all([
      prisma.pcStockBalance.findMany({
        where,
        include: { line: { include }, item: true },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.pcStockBalance.count({ where }),
    ]);
    total = count;
    rows = stocks.map((s) => ({
      ...pcLineRow(s.line),
      id: s.id,
      lineId: s.lineId,
      kind: "stock",
      version: s.version,
      number: s.item.number,
      onHand: s.onHand,
      issued: s.issued,
      warehouse: s.warehouse,
      location: s.location,
    }));
  } else {
    const where = lineWhere(q, a);
    const [ps, count, agg] = await Promise.all([
      prisma.pcLine.findMany({
        where,
        include,
        orderBy:
          q.sort === "amount"
            ? { payableCents: "desc" }
            : q.sort === "need"
              ? { needDate: "asc" }
              : { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.pcLine.count({ where }),
      prisma.pcLine.groupBy({
        by: ["status"],
        where,
        _sum: { payableCents: true, estimateCents: true },
      }),
    ]);
    rows = ps.map(pcLineRow);
    total = count;
    totalCents = agg.reduce(
      (s, g) =>
        s +
        (g.status === "ORDERED"
          ? g._sum.payableCents || 0
          : g._sum.estimateCents || 0),
      0,
    );
  }
  const counts: Record<string, number> = {};
  await Promise.all(
    PC_VIEWS.map(async (v) => {
      counts[v.id] =
        v.id === "stock"
          ? await prisma.pcStockBalance.count()
          : ["funds", "finance"].includes(v.id)
            ? await prisma.pcFund.count({
                where: fundWhere({ ...q, ids: undefined }, a, v.id),
              })
            : await prisma.pcLine.count({
                where: lineWhere({ ...q, ids: undefined }, a, v.id),
              });
    }),
  );
  return {
    rows,
    total,
    totalCents,
    page,
    pageSize,
    counts,
    settings: settings
      ? {
          ownerId: settings.ownerId,
          purchaseApproverIds: settings.purchaseApproverIds,
          fundApproverIds: settings.fundApproverIds,
          financeIds: settings.financeIds,
          buyerIds: settings.buyerIds,
          version: settings.version,
        }
      : null,
    users: users.map((u) => ({ id: u.id, name: u.displayName || u.username })),
    suppliers,
    permissions,
  };
}
export async function purchasingDetail(id: string, a: PcActor) {
  const stock = await prisma.pcStockBalance.findUnique({
    where: { id },
    select: { lineId: true },
  });
  if (stock) id = stock.lineId;
  const returned = await prisma.pcReturn.findUnique({
    where: { id },
    select: { lineId: true },
  });
  if (returned) id = returned.lineId;
  const request = await prisma.pcRequest.findFirst({
    where: { id, deletedAt: null },
    include: {
      lines: { where: { status: { not: "VOID" } }, orderBy: { number: "asc" } },
    },
  });
  if (request) {
    if (
      request.status === "DRAFT" &&
      ![request.applicantId, request.submitterId].includes(a.id)
    )
      throw new PurchasingError("该草稿不属于你", "PURCHASING_FORBIDDEN", 403);
    return plain({
      kind: "request" as const,
      record: request,
      events: await prisma.pcEvent.findMany({
        where: { entityType: "REQUEST", entityId: id },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      attachments: await prisma.pcAttachment.findMany({
        where: { entityType: "REQUEST", entityId: id, deletedAt: null },
        select: {
          id: true,
          originalName: true,
          entityType: true,
          entityId: true,
          size: true,
        },
      }),
    });
  }
  const fund = await prisma.pcFund.findUnique({
    where: { id },
    include: {
      allocations: { include: { line: { include: { request: true } } } },
      payments: true,
    },
  });
  if (fund)
    return plain({
      kind: "fund" as const,
      record: fund,
      events: await prisma.pcEvent.findMany({
        where: { entityType: "FUND", entityId: id },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      attachments: await prisma.pcAttachment.findMany({
        where: {
          deletedAt: null,
          OR: [
            { entityType: "FUND", entityId: id },
            {
              entityType: "PAYMENT",
              entityId: { in: fund.payments.map((p) => p.id) },
            },
          ],
        },
        select: {
          id: true,
          originalName: true,
          entityType: true,
          entityId: true,
          size: true,
        },
      }),
    });
  const p = await prisma.pcLine.findUnique({
    where: { id },
    include: {
      request: {
        include: {
          lines: {
            where: { status: { not: "VOID" } },
            orderBy: { number: "asc" },
          },
        },
      },
      supplier: true,
      item: true,
      allocations: { include: { fund: { include: { payments: true } } } },
      receipts: true,
      returns: { include: { refunds: true } },
      balances: {
        include: { movements: { orderBy: { createdAt: "desc" }, take: 100 } },
      },
      contractLines: { include: { contract: true } },
      invoiceLines: { include: { invoice: true } },
    },
  });
  if (!p || p.request.deletedAt)
    throw new PurchasingError("采购记录不存在", "PURCHASING_NOT_FOUND", 404);
  if (
    p.status === "DRAFT" &&
    ![p.request.applicantId, p.request.submitterId].includes(a.id)
  )
    throw new PurchasingError("该草稿不属于你", "PURCHASING_FORBIDDEN", 403);
  const ids = [
    p.id,
    p.requestId,
    ...p.contractLines.map((x) => x.contractId),
    ...p.invoiceLines.map((x) => x.invoiceId),
    ...p.allocations.map((x) => x.fundId),
    ...p.allocations.flatMap((x) => x.fund.payments.map((y) => y.id)),
    ...p.returns.flatMap((x) => x.refunds.map((y) => y.id)),
  ];
  return plain({
    kind: "line" as const,
    record: p,
    events: await prisma.pcEvent.findMany({
      where: { entityType: "LINE", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 150,
    }),
    attachments: await prisma.pcAttachment.findMany({
      where: { entityId: { in: ids }, deletedAt: null },
      select: {
        id: true,
        originalName: true,
        entityType: true,
        entityId: true,
        size: true,
      },
    }),
  });
}
export type PcDetail = Awaited<ReturnType<typeof purchasingDetail>>;
export async function purchasingLookups(q: URLSearchParams) {
  if (q.get("type") === "accounts") {
    const mode = q.get("settlement") || "CORPORATE",
      name = q.get("supplier") || "",
      userId = q.get("payeeUserId") || "";
    const line = await prisma.pcLine.findFirst({
      where: {
        status: "ORDERED",
        settlement: mode,
        ...(mode === "ADVANCE"
          ? { payeeUserId: userId }
          : { supplier: { name } }),
      },
      orderBy: { updatedAt: "desc" },
      select: {
        payee: true,
        payeeUserId: true,
        bank: true,
        account: true,
        updatedAt: true,
      },
    });
    return plain(line);
  }
  if (q.get("type") === "workorders")
    return prisma.workOrder.findMany({
      where: {
        code: {
          contains: (q.get("q") || "").slice(0, 100),
          mode: "insensitive",
        },
      },
      select: { id: true, code: true },
      take: 30,
      orderBy: { createdAt: "desc" },
    });
  return prisma.pcItem.findMany({
    where: {
      OR: [
        {
          name: {
            contains: (q.get("q") || "").slice(0, 100),
            mode: "insensitive",
          },
        },
        { number: { contains: q.get("q") || "", mode: "insensitive" } },
      ],
    },
    take: 30,
    orderBy: { createdAt: "desc" },
  });
}
export async function purchasingContract(id: string) {
  const c = await prisma.pcContract.findUnique({ where: { id } });
  if (!c) throw new PurchasingError("合同不存在", "PURCHASING_NOT_FOUND", 404);
  return plain(c);
}

function purchasingTaskFilters(
  task: string | undefined,
  id: string,
  s: {
    purchaseApproverIds: string[];
    buyerIds: string[];
    financeIds: string[];
  } | null,
): Pick<PcQuery, "lineTask" | "fundTask"> {
  if (task === "approval")
    return {
      lineTask: s?.purchaseApproverIds.includes(id)
        ? { status: "PENDING" }
        : { id: "__no_task__" },
    };
  if (task === "execution")
    return {
      lineTask: s?.buyerIds.includes(id)
        ? {
            completedAt: null,
            OR: [{ status: "APPROVED" }, { status: "ORDERED", buyerId: id }],
          }
        : { id: "__no_task__" },
    };
  if (task === "finance")
    return {
      fundTask: s?.financeIds.includes(id)
        ? { status: { in: ["APPROVED", "PARTIAL"] } }
        : { id: "__no_task__" },
    };
  if (task === "requests")
    return {
      lineTask: { request: { OR: [{ applicantId: id }, { submitterId: id }] } },
    };
  return {};
}
export async function purchasingHomeSummary(a: PcActor) {
  const s = await prisma.pcSettings.findUnique({ where: { id: "purchasing" } });
  const count = (task: string, view: string) =>
    prisma.pcLine.count({
      where: lineWhere(
        { task, view, ...purchasingTaskFilters(task, a.id, s) },
        a,
      ),
    });
  const [approval, execution, finance, requests] = await Promise.all([
    count("approval", "approval"),
    count("execution", "execution"),
    prisma.pcFund.count({
      where: fundWhere(
        { view: "finance", ...purchasingTaskFilters("finance", a.id, s) },
        a,
      ),
    }),
    count("requests", "all"),
  ]);
  return { approval, execution, finance, requests };
}
