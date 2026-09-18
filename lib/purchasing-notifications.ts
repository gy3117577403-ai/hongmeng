import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  PurchasingError,
  pcMoney,
  pcVersion,
  type PcInput,
} from "@/lib/purchasing-domain";
import type { PcActor } from "@/lib/purchasing-service";
import {
  inspectWeComRobotConfig,
  sendWeComRobotText,
  WeComRobotError,
} from "@/lib/wecom-robot";
import { wecomIdentity } from "@/lib/wecom-identity";

type Tx = Prisma.TransactionClient;
export const PC_PUSH_LABELS: Record<string, string> = {
  SAVE_REQUEST: "新请购 / 重新提交",
  APPROVE_LINES: "采购审批通过",
  RETURN_LINES: "请购退回",
  WITHDRAW_LINES: "请购撤回",
  VOID_LINES: "采购作废",
  CREATE_FUND: "资金待审批",
  APPROVE_FUNDS: "资金通过 · 待付款",
  RETURN_FUNDS: "资金退回",
  WITHDRAW_FUND: "资金撤回",
  CLOSE_FUND: "未付余额关闭",
  TEST: "推送连接测试",
};
type PushRecord = {
  id: string;
  version?: number;
  kind: "line" | "fund";
  number: string;
  name: string;
  status: string;
  amount: number;
  applicant: string;
  needDate: string;
  urgency: string;
  purpose: string;
};
type PushPayload = { records: PushRecord[]; actor: string; reason: string };
const compact = (v: string, n = 100) =>
  Array.from(v.replace(/[\r\n\t<>]/g, " ").trim())
    .slice(0, n)
    .join("");
export function purchasingPushOrigin(value: string | undefined | null) {
  try {
    const u = new URL(value || "");
    return u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      u.pathname === "/" &&
      !u.search &&
      !u.hash &&
      !["localhost", "127.0.0.1", "0.0.0.0"].includes(u.hostname)
      ? u.origin
      : null;
  } catch {
    return null;
  }
}
function secretKey() {
  const key =
    process.env.PURCHASING_PUSH_ENCRYPTION_KEY ||
    process.env.SESSION_SECRET ||
    "";
  if (key.length < 32)
    throw new PurchasingError("服务端密钥尚未配置，无法保存推送地址");
  return createHash("sha256")
    .update("purchasing-webhook-v1:" + key)
    .digest();
}
function seal(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data]
    .map((b) => b.toString("base64url"))
    .join(".");
}
function unseal(value: string) {
  const [iv, tag, data] = value
    .split(".")
    .map((v) => Buffer.from(v, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}
async function pushConfig(tx: Tx | typeof prisma = prisma) {
  const saved = await tx.pcPushConfig.findUnique({
    where: { id: "purchasing" },
  });
  let webhook = process.env.PURCHASING_WECOM_WEBHOOK_URL || "",
    error = "";
  if (saved?.webhookEncrypted) {
    try {
      webhook = unseal(saved.webhookEncrypted);
    } catch {
      webhook = "";
      error = "推送密钥无法解密，请重新保存机器人地址";
    }
  }
  const origin = purchasingPushOrigin(
    saved?.origin || process.env.APP_BASE_URL,
  );
  const valid = inspectWeComRobotConfig(webhook).configured;
  return {
    saved,
    webhook,
    origin,
    enabled: saved?.enabled ?? true,
    error:
      error ||
      (!valid
        ? "请配置采购专用群机器人地址"
        : !origin
          ? "请配置正式 HTTPS 站点根地址"
          : ""),
    configured: valid && !!origin,
  };
}
async function requireMaintainer(tx: Tx, actor: PcActor) {
  const s = await tx.pcSettings.findUnique({ where: { id: "purchasing" } });
  if (!s || (s.ownerId !== actor.id && actor.laborRole !== "ADMIN"))
    throw new PurchasingError(
      "请由采购流程维护人配置推送",
      "PURCHASING_FORBIDDEN",
      403,
    );
}
export async function purchasingPushStatus(actor: PcActor, record?: string) {
  const [c, s, rows] = await Promise.all([
    pushConfig(),
    prisma.pcSettings.findUnique({ where: { id: "purchasing" } }),
    prisma.pcNotification.findMany({
      where: record ? { recordIds: { has: record } } : {},
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        id: true,
        action: true,
        state: true,
        attempts: true,
        lastError: true,
        createdAt: true,
        sentAt: true,
        recordIds: true,
        payload: true,
      },
    }),
  ]);
  return {
    enabled: c.enabled,
    configured: c.configured,
    message: c.error,
    source: c.saved?.webhookEncrypted ? "已保存的采购机器人" : "服务端环境配置",
    origin: c.origin || "",
    version: c.saved?.version || 0,
    canConfigure:
      !!s && (s.ownerId === actor.id || actor.laborRole === "ADMIN"),
    rows: rows.map(({ payload, ...row }) => ({
      ...row,
      records: (payload as unknown as PushPayload).records.map((r) => ({
        id: r.id,
        number: r.number,
        name: r.name,
      })),
    })),
  };
}
export async function configurePurchasingPush(input: PcInput, actor: PcActor) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pc-push-config'))`;
    await requireMaintainer(tx, actor);
    const old = await tx.pcPushConfig.findUnique({
      where: { id: "purchasing" },
    });
    pcVersion(old?.version || 0, input.version);
    const webhook =
      typeof input.webhook === "string" ? input.webhook.trim() : "";
    if (webhook && !inspectWeComRobotConfig(webhook).configured)
      throw new PurchasingError("请输入有效的企业微信群机器人地址");
    const origin = purchasingPushOrigin(
      String(input.origin || process.env.APP_BASE_URL || ""),
    );
    if (!origin)
      throw new PurchasingError(
        "请填写正式 HTTPS 站点根地址，例如 https://采购站点域名",
      );
    const data = {
      enabled: input.enabled === true,
      origin,
      ...(webhook ? { webhookEncrypted: seal(webhook) } : {}),
    };
    await tx.pcPushConfig.upsert({
      where: { id: "purchasing" },
      create: { ...data },
      update: { ...data, version: { increment: 1 } },
    });
    await tx.pcEvent.create({
      data: {
        entityType: "SETTINGS",
        entityId: "purchasing",
        action: "PUSH_CONFIG",
        actorId: actor.id,
        actorName: actor.displayName || actor.username,
        snapshot: { enabled: data.enabled, origin, webhookChanged: !!webhook },
      },
    });
  });
  return purchasingPushStatus(actor);
}
export async function enqueuePurchasingPush(
  tx: Tx,
  input: PcInput,
  result: unknown,
  actor: PcActor,
  key: string,
) {
  const action = String(input.action);
  if (
    !PC_PUSH_LABELS[action] ||
    action === "TEST" ||
    (action === "SAVE_REQUEST" && input.submit !== true)
  )
    return;
  const out = result as { id?: string; lineIds?: string[] };
  const ids =
    action === "SAVE_REQUEST"
      ? out.lineIds || []
      : action === "CREATE_FUND"
        ? [out.id!]
        : Array.isArray(input.entries)
          ? input.entries.map((e) => String((e as { id: string }).id))
          : [String(input.id)];
  const fundEvent = action.includes("FUND");
  const s = await tx.pcSettings.findUniqueOrThrow({
    where: { id: "purchasing" },
  });
  let records: PushRecord[] = [],
    recipients: string[] = [];
  if (fundEvent) {
    const funds = await tx.pcFund.findMany({ where: { id: { in: ids } } });
    records = funds.map((f) => ({
      id: f.id,
      version: f.version,
      kind: "fund",
      number: f.number,
      name: f.payee,
      status: f.status,
      amount: f.amountCents,
      applicant: f.actorName,
      needDate: f.dueDate,
      urgency: "NORMAL",
      purpose: "",
    }));
    recipients =
      action === "CREATE_FUND"
        ? s.fundApproverIds
        : action === "APPROVE_FUNDS"
          ? s.financeIds
          : funds.map((f) => f.actorId);
  } else {
    const lines = await tx.pcLine.findMany({
      where: { id: { in: ids } },
      include: { request: true },
    });
    records = lines.map((l) => ({
      id: l.id,
      version: l.version,
      kind: "line",
      number: l.number,
      name: `${l.name} · ${l.quantity}${l.unit}`,
      status: l.status,
      amount: l.estimateCents,
      applicant: l.request.applicantName,
      needDate: l.needDate,
      urgency: l.urgency,
      purpose: l.request.purpose,
    }));
    recipients =
      action === "SAVE_REQUEST"
        ? s.purchaseApproverIds
        : action === "APPROVE_LINES"
          ? s.buyerIds
          : action === "RETURN_LINES"
            ? lines.flatMap((l) => [
                l.request.applicantId,
                l.request.submitterId,
              ])
            : [
                ...s.purchaseApproverIds,
                ...s.buyerIds,
                ...lines.map((l) => l.request.applicantId),
              ];
  }
  if (!records.length) return;
  const cfg = await tx.pcPushConfig.findUnique({ where: { id: "purchasing" } });
  await tx.pcNotification.create({
    data: {
      dedupeKey: key,
      action,
      recordIds: records.map((r) => r.id),
      recipientIds: [...new Set(recipients)],
      state: cfg?.enabled === false ? "SKIPPED" : "PENDING",
      lastError: cfg?.enabled === false ? "提交时采购群推送已关闭" : "",
      payload: {
        records,
        actor: actor.displayName || actor.username,
        reason: String(input.reason || ""),
      } as unknown as Prisma.InputJsonValue,
    },
  });
}
export function buildPurchasingPush(
  action: string,
  payload: PushPayload,
  names: string[],
  url: string,
) {
  if (action === "TEST")
    return (
      "【杭连采购｜推送连接测试】\n这是一条采购群接入验证消息，无需审批。\n操作人：" +
      compact(payload.actor, 30) +
      "\n采购工作台：" +
      url
    );
  const urgency = payload.records.some((r) => r.urgency === "CRITICAL")
    ? "｜特急"
    : payload.records.some((r) => r.urgency === "URGENT")
      ? "｜紧急"
      : "";
  const count = payload.records.length;
  let body = [
    `【杭连采购｜${PC_PUSH_LABELS[action] || "采购通知"}${urgency}】`,
    `操作人：${compact(payload.actor, 30)}`,
    `共 ${count} ${payload.records[0]?.kind === "fund" ? "张资金单" : "项物品"}`,
    ...payload.records
      .slice(0, 3)
      .map(
        (r) =>
          `${r.number} · ${compact(r.name, 45)}\n申请人：${compact(r.applicant, 30)}${r.needDate ? "　需求/到期：" + r.needDate : ""}`,
      ),
    `${payload.records[0]?.kind === "fund" ? "资金合计" : "预估合计"}：${pcMoney(payload.records.reduce((n, r) => n + r.amount, 0))}`,
    payload.records[0]?.purpose
      ? `用途：${compact(payload.records[0].purpose, 80)}`
      : "",
    payload.reason ? `原因：${compact(payload.reason, 100)}` : "",
    names.length
      ? `请处理：${compact(names.join("、"), 100)}`
      : "请相关负责人查看站内待办",
    count > 3 ? `另有 ${count - 3} 项，请打开工作台查看。` : "",
    action === "TEST" ? "这是一条接入验证消息，无需审批。" : "",
  ]
    .filter(Boolean)
    .join("\n");
  const suffix = "\n\n查看并处理：" + url;
  while (Buffer.byteLength(body + suffix, "utf8") > 2000 && body.length)
    body = Array.from(body).slice(0, -1).join("");
  return body + suffix;
}
export async function controlPurchasingPush(
  input: PcInput,
  actor: PcActor,
  key: string,
) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pc-push-config'))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pc-push-dispatch'))`;
    await requireMaintainer(tx, actor);
    if (input.action === "TEST") {
      const c = await pushConfig(tx);
      if (!c.enabled || !c.configured)
        throw new PurchasingError(c.error || "请先启用采购推送");
      await tx.pcNotification.upsert({
        where: { dedupeKey: "test:" + key },
        update: {},
        create: {
          dedupeKey: "test:" + key,
          action: "TEST",
          recordIds: [],
          recipientIds: [actor.id],
          payload: {
            records: [],
            actor: actor.displayName || actor.username,
            reason: "采购群机器人接入验证",
          },
        },
      });
    } else {
      const row = await tx.pcNotification.findUniqueOrThrow({
        where: { id: String(input.id) },
      });
      if (!["FAILED", "UNCERTAIN", "WAITING_CONFIG"].includes(row.state))
        throw new PurchasingError("当前发送状态无需重试");
      if (row.state === "UNCERTAIN" && input.confirmNotReceived !== true)
        throw new PurchasingError("请先在群中核对，确认未收到后再补发");
      await tx.pcNotification.update({
        where: { id: row.id },
        data: {
          state: "PENDING",
          attempts: 0,
          availableAt: new Date(),
          lastError: "",
          leaseToken: null,
        },
      });
    }
    await tx.pcEvent.create({
      data: {
        entityType: "SETTINGS",
        entityId: "purchasing",
        action: "PUSH_" + String(input.action),
        actorId: actor.id,
        actorName: actor.displayName || actor.username,
        snapshot: {
          notificationId: String(input.id || ""),
          confirmedNotReceived: input.confirmNotReceived === true,
        },
      },
    });
  });
  return purchasingPushStatus(actor);
}
export async function dispatchPurchasingPush(
  options: {
    fetchImpl?: typeof fetch;
    webhookUrl?: string;
    origin?: string;
    now?: Date;
    notificationId?: string;
  } = {},
) {
  const now = options.now || new Date();
  const claimed = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pc-push-dispatch'))`;
      await tx.pcNotification.updateMany({
        where: {
          state: "SENDING",
          updatedAt: { lt: new Date(now.getTime() - 120000) },
        },
        data: {
          state: "UNCERTAIN",
          leaseToken: null,
          lastError: "发送进程中断，回执未知；请核对群消息后再决定是否补发",
        },
      });
      const c = await pushConfig(tx);
      if (!c.enabled) return null;
      const clock = await tx.pcPushClock.findUnique({
        where: { id: "purchasing" },
      });
      if (clock && now.getTime() - clock.lastAttemptAt.getTime() < 6000)
        return null;
      const row = await tx.pcNotification.findFirst({
        where: {
          ...(options.notificationId ? { id: options.notificationId } : {}),
          state: { in: ["PENDING", "FAILED", "WAITING_CONFIG"] },
          attempts: { lt: 6 },
          availableAt: { lte: now },
        },
        orderBy: { createdAt: "asc" },
      });
      if (!row) return null;
      const payload = row.payload as unknown as PushPayload;
      // A returned request may be submitted again with the same status and ID.
      // Compare event versions without suppressing a reminder after a note edit.
      const related = row.recordIds.length
        ? await tx.pcNotification.findMany({
            where: {
              action: row.action,
              recordIds: { hasSome: row.recordIds },
              id: { not: row.id },
            },
            select: { payload: true },
          })
        : [];
      const latestVersions = new Map<string, number>();
      for (const event of related)
        for (const r of (event.payload as unknown as PushPayload).records) {
          latestVersions.set(
            r.id,
            Math.max(latestVersions.get(r.id) || 0, r.version || 0),
          );
        }
      const records: PushRecord[] = [];
      for (const r of payload.records) {
        if ((latestVersions.get(r.id) || 0) > (r.version || 0)) continue;
        const current =
          r.kind === "line"
            ? await tx.pcLine.findUnique({
                where: { id: r.id },
                include: { request: true },
              })
            : await tx.pcFund.findUnique({ where: { id: r.id } });
        if (
          current?.status === r.status &&
          !("request" in current && current.request.deletedAt)
        )
          records.push(r);
      }
      if (!records.length && row.action !== "TEST") {
        await tx.pcNotification.update({
          where: { id: row.id },
          data: {
            state: "SKIPPED",
            lastError: "业务状态已推进，不发送过期待办",
          },
        });
        return null;
      }
      const webhook = options.webhookUrl ?? c.webhook,
        origin = purchasingPushOrigin(options.origin) || c.origin;
      if (!origin || !inspectWeComRobotConfig(webhook).configured) {
        await tx.pcNotification.update({
          where: { id: row.id },
          data: {
            state: "WAITING_CONFIG",
            lastError: c.error || "请完善推送配置",
            availableAt: new Date(now.getTime() + 60000),
          },
        });
        return null;
      }
      const users = await tx.user.findMany({
        where: {
          id: { in: row.recipientIds },
          isActive: true,
          accountStatus: "ACTIVE",
        },
        include: { employee: true },
      });
      const identities = users
        .filter((u) => u.employee?.isActive && u.employee.notificationEnabled)
        .map((u) => wecomIdentity(u.employee!));
      const path = records[0]
        ? "/workspace/purchases?record=" + encodeURIComponent(records[0].id)
        : "/workspace/purchases";
      const content = buildPurchasingPush(
        row.action,
        { ...payload, records },
        users.map((u) => u.displayName || u.username),
        origin + path,
      );
      const lease = randomUUID();
      await tx.pcNotification.update({
        where: { id: row.id },
        data: {
          state: "SENDING",
          leaseToken: lease,
          updatedAt: now,
          attempts: { increment: 1 },
          content,
          lastError: "",
        },
      });
      await tx.pcPushClock.upsert({
        where: { id: "purchasing" },
        create: { id: "purchasing", lastAttemptAt: now },
        update: { lastAttemptAt: now },
      });
      return {
        row,
        lease,
        content,
        webhook,
        mobiles: identities.flatMap((i) => i.mentionedMobiles),
        userIds: identities.flatMap((i) => i.mentionedUserIds),
      };
    },
    { maxWait: 5000, timeout: 20000 },
  );
  if (!claimed) return { sent: false };
  try {
    await sendWeComRobotText({
      source: { sourceType: "PURCHASING", eventType: claimed.row.action },
      content: claimed.content,
      mentionedMobiles: claimed.mobiles.slice(
        0,
        Math.max(0, 20 - claimed.userIds.length),
      ),
      mentionedUserIds: claimed.userIds.slice(0, 20),
      webhookUrl: claimed.webhook,
      fetchImpl: options.fetchImpl,
    });
    await prisma.pcNotification.updateMany({
      where: {
        id: claimed.row.id,
        leaseToken: claimed.lease,
        state: "SENDING",
      },
      data: { state: "SENT", sentAt: now, leaseToken: null },
    });
    return { sent: true, id: claimed.row.id };
  } catch (e) {
    const explicit =
      e instanceof WeComRobotError &&
      [
        "WECOM_REJECTED",
        "WECOM_MENTION_MOBILE_MISSING",
        "WECOM_RECIPIENT_LIMIT",
        "WECOM_SOURCE_BLOCKED",
      ].includes(e.code);
    const reason =
      e instanceof WeComRobotError
        ? e.message
        : "发送回执未知，请核对群消息后再决定是否补发";
    await prisma.pcNotification.updateMany({
      where: {
        id: claimed.row.id,
        leaseToken: claimed.lease,
        state: "SENDING",
      },
      data: {
        state: explicit ? "FAILED" : "UNCERTAIN",
        leaseToken: null,
        lastError: reason,
        availableAt: new Date(
          now.getTime() + Math.min(3600000, 60000 * 2 ** claimed.row.attempts),
        ),
      },
    });
    return { sent: false, uncertain: !explicit, id: claimed.row.id };
  }
}
