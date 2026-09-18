import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import {
  buildPurchasingPush,
  configurePurchasingPush,
  controlPurchasingPush,
  dispatchPurchasingPush,
  purchasingPushOrigin,
  purchasingPushStatus,
} from "../lib/purchasing-notifications";
import { mutatePurchasing } from "../lib/purchasing-service";
import {
  purchasingHomeSummary,
  loadPurchasing,
} from "../lib/purchasing-queries";
import { sendWeComRobotText } from "../lib/wecom-robot";
import { purchasingNextStep } from "../lib/purchasing-presentation";
const webhook =
  "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=disposable_test_key_0123456789";
test("杭连采购 summary retains exact prefix, bounded UTF8 text and authenticated record URL", () => {
  const body = buildPurchasingPush(
    "SAVE_REQUEST",
    {
      records: Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        kind: "line",
        number: "CG" + i,
        name: "扭力工具".repeat(100),
        status: "PENDING",
        amount: 100,
        applicant: "申请人",
        needDate: "2026-09-18",
        urgency: "URGENT",
        purpose: "生产使用",
      })),
      actor: "测试员",
      reason: "原因".repeat(100),
    },
    ["采购员"],
    "https://example.test/workspace/purchases?record=123",
  );
  assert.ok(body.startsWith("【杭连采购｜"));
  assert.ok(!body.includes("鸿蒙"));
  assert.ok(body.includes("共 100 项物品"));
  assert.ok(Buffer.byteLength(body, "utf8") <= 2048);
  assert.ok(body.endsWith("?record=123"));
  assert.equal(purchasingPushOrigin("http://example.test"), null);
  assert.equal(purchasingPushOrigin("https://evil.test/?return=bad"), null);
  assert.match(
    purchasingNextStep({
      status: "APPROVED",
      completedAt: null,
      quantity: 1,
      receivedQty: 0,
      cancelledQty: 0,
      payableCents: 0,
      paidCents: 0,
      refundedCents: 0,
      invoiceCents: 0,
    }),
    /待登记采购/,
  );
});
test("procurement broadcast without employee identity uses only its own webhook; quality still requires mention", async () => {
  let called = 0;
  await sendWeComRobotText({
    source: { sourceType: "PURCHASING", eventType: "SAVE_REQUEST" },
    content: "【杭连采购】测试",
    webhookUrl: webhook,
    fetchImpl: async (_u, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.text.mentioned_list, undefined);
      called++;
      return new Response('{"errcode":0}');
    },
  });
  assert.equal(called, 1);
  await assert.rejects(
    sendWeComRobotText({
      source: { sourceType: "internal_quality_risk", eventType: "ASSIGNED" },
      content: "质量",
      webhookUrl: webhook,
      fetchImpl: async () => {
        throw Error("must not fetch");
      },
    }),
    /手机号/,
  );
});
test(
  "purchasing outbox transaction, aggregation, state freshness, unknown delivery and private config",
  { skip: process.env.RUN_DB_INTEGRATION !== "1" },
  async (t) => {
    const marker = "PCP-" + randomUUID().slice(0, 8),
      secret = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET ||=
      "disposable-purchasing-push-session-key-12345678";
    const owner = await prisma.user.create({
      data: {
        username: marker,
        passwordHash: "not-a-login-hash",
        displayName: "推送验收",
        laborRole: "ADMIN",
      },
    });
    const other = await prisma.user.create({
      data: {
        username: marker + "x",
        displayName: "其他人员",
        passwordHash: "not-a-login-hash",
      },
    });
    const oldSettings = await prisma.pcSettings.findUnique({
        where: { id: "purchasing" },
      }),
      oldConfig = await prisma.pcPushConfig.findUnique({
        where: { id: "purchasing" },
      });
    const run = (input: Record<string, unknown>, key = marker + randomUUID()) =>
      mutatePurchasing(input, owner, key) as Promise<any>;
    const rows: string[] = [];
    let clock = Date.now() + 10000000;
    const now = () => new Date((clock += 100000));
    const query = (key: string) =>
      prisma.pcNotification.findUniqueOrThrow({ where: { dedupeKey: key } });
    const create = async (
      n = 3,
      submit = true,
      key = marker + randomUUID(),
    ) => {
      const data = await run(
        {
          action: "SAVE_REQUEST",
          submit,
          purpose: marker,
          lines: Array.from({ length: n }, (_, i) => ({
            name: "验收物品" + i,
            spec: "M8",
            unit: "件",
            quantity: 2,
            estimateCents: 1200,
            needDate: "2026-09-18",
          })),
        },
        key,
      );
      rows.push(...data.lineIds);
      return { data, key };
    };
    const entry = async (id: string) => {
      const l = await prisma.pcLine.findUniqueOrThrow({ where: { id } });
      return { id, version: l.version };
    };
    try {
      await run({
        action: "SAVE_SETTINGS",
        version: oldSettings?.version,
        reason: "独立测试",
        ownerId: owner.id,
        purchaseApproverIds: [owner.id],
        buyerIds: [owner.id],
        fundApproverIds: [owner.id],
        financeIds: [owner.id],
      });
      await configurePurchasingPush(
        {
          version: oldConfig?.version || 0,
          enabled: true,
          webhook,
          origin: "https://example.test",
        },
        owner,
      );
      await t.test(
        "credentials encrypted and never returned; setup ownership and stale version enforced",
        async () => {
          const c = await prisma.pcPushConfig.findUniqueOrThrow({
            where: { id: "purchasing" },
          });
          assert.ok(!c.webhookEncrypted.includes("disposable_test_key"));
          const status = await purchasingPushStatus(owner);
          assert.ok(!JSON.stringify(status).includes("disposable_test_key"));
          assert.equal(status.configured, true);
          await assert.rejects(
            configurePurchasingPush(
              {
                version: c.version,
                enabled: true,
                origin: "https://example.test",
              },
              other,
            ),
            /维护人/,
          );
          await assert.rejects(
            configurePurchasingPush(
              { version: 0, enabled: true, origin: "https://example.test" },
              owner,
            ),
            /已被更新/,
          );
        },
      );
      await t.test(
        "draft silent, one batch one message, replay no duplicates and failed batch no event",
        async () => {
          const draft = await create(2, false);
          assert.equal(
            await prisma.pcNotification.count({
              where: { dedupeKey: draft.key },
            }),
            0,
          );
          const created = await create();
          const row = await query(created.key);
          assert.equal(row.recordIds.length, 3);
          const pending = await prisma.pcLine.findMany({
            where: { id: { in: created.data.lineIds } },
          });
          const key = marker + randomUUID();
          const input = {
            action: "APPROVE_LINES",
            entries: pending.map((l) => ({ id: l.id, version: l.version })),
          };
          await run(input, key);
          await run(input, key);
          assert.equal(
            await prisma.pcNotification.count({ where: { dedupeKey: key } }),
            1,
          );
          const before = await prisma.pcNotification.count();
          await assert.rejects(
            run(
              { ...input, entries: [{ id: pending[0].id, version: 0 }] },
              marker + "conflict",
            ),
          );
          assert.equal(await prisma.pcNotification.count(), before);
          await dispatchPurchasingPush({
            notificationId: row.id,
            now: now(),
            fetchImpl: async () => {
              throw Error("obsolete must not send");
            },
          });
          assert.equal((await query(created.key)).state, "SKIPPED");
        },
      );
      await t.test(
        "partial approval keeps remaining current items; two dispatchers send once; home count matches linked queue",
        async () => {
          const c = await create(3);
          const item = await query(c.key);
          await run({
            action: "APPROVE_LINES",
            entries: [await entry(c.data.lineIds[0])],
          });
          let calls = 0;
          const fetchImpl: typeof fetch = async (_u, init) => {
            calls++;
            const body = JSON.parse(String(init?.body));
            assert.match(body.text.content, /共 2 项物品/);
            assert.match(body.text.content, /杭连采购/);
            return new Response('{"errcode":0}');
          };
          const time = now();
          await Promise.all([
            dispatchPurchasingPush({
              notificationId: item.id,
              now: time,
              fetchImpl,
            }),
            dispatchPurchasingPush({
              notificationId: item.id,
              now: time,
              fetchImpl,
            }),
          ]);
          assert.equal(calls, 1);
          assert.equal((await query(c.key)).state, "SENT");
          const summary = await purchasingHomeSummary(owner);
          const queue = await loadPurchasing(
            { view: "approval", task: "approval" },
            owner,
          );
          assert.equal(summary.approval, queue.total);
          const hidden = await purchasingHomeSummary(other);
          assert.equal(hidden.approval, 0);
        },
      );
      await t.test(
        "resubmitted request supersedes its older pending reminder even when status matches",
        async () => {
          const c = await create(1);
          await run({
            action: "RETURN_LINES",
            entries: [await entry(c.data.lineIds[0])],
            reason: "补充规格",
          });
          const current = await prisma.pcLine.findUniqueOrThrow({
            where: { id: c.data.lineIds[0] },
          });
          const request = await prisma.pcRequest.findUniqueOrThrow({
            where: { id: current.requestId },
          });
          const key = marker + randomUUID();
          await run(
            {
              action: "SAVE_REQUEST",
              requestId: request.id,
              version: request.version,
              submit: true,
              purpose: marker,
              lines: [
                {
                  id: current.id,
                  version: current.version,
                  name: "重新提交的物品",
                  spec: "M8",
                  unit: "件",
                  quantity: 2,
                  estimateCents: 1200,
                  needDate: "2026-09-18",
                },
              ],
            },
            key,
          );
          const old = await query(c.key);
          await dispatchPurchasingPush({
            notificationId: old.id,
            now: now(),
            fetchImpl: async () => {
              throw Error("superseded request must not send");
            },
          });
          assert.equal((await query(c.key)).state, "SKIPPED");
          let calls = 0;
          const fresh = await query(key);
          await dispatchPurchasingPush({
            notificationId: fresh.id,
            now: now(),
            fetchImpl: async (_u, init) => {
              calls++;
              assert.match(
                JSON.parse(String(init?.body)).text.content,
                /重新提交的物品/,
              );
              return new Response('{"errcode":0}');
            },
          });
          assert.equal(calls, 1);
          assert.equal((await query(key)).state, "SENT");
        },
      );
      await t.test(
        "timeout is uncertain, never automatically retried; deliberate retry requires confirmation",
        async () => {
          const c = await create(1);
          const item = await query(c.key);
          let calls = 0;
          await dispatchPurchasingPush({
            notificationId: item.id,
            now: now(),
            fetchImpl: async () => {
              calls++;
              throw new DOMException("timeout", "TimeoutError");
            },
          });
          assert.equal((await query(c.key)).state, "UNCERTAIN");
          await dispatchPurchasingPush({
            notificationId: item.id,
            now: now(),
            fetchImpl: async () => {
              calls++;
              return new Response('{"errcode":0}');
            },
          });
          assert.equal(calls, 1);
          await assert.rejects(
            controlPurchasingPush(
              { action: "RETRY", id: item.id },
              owner,
              marker + "retry",
            ),
            /核对/,
          );
          await controlPurchasingPush(
            { action: "RETRY", id: item.id, confirmNotReceived: true },
            owner,
            marker + "retry2",
          );
          await dispatchPurchasingPush({
            notificationId: item.id,
            now: now(),
            fetchImpl: async () => new Response('{"errcode":0}'),
          });
          assert.equal((await query(c.key)).state, "SENT");
        },
      );
      await t.test(
        "explicit API rejection retains retry state and stored business remains intact",
        async () => {
          const c = await create(1),
            item = await query(c.key);
          await dispatchPurchasingPush({
            notificationId: item.id,
            now: now(),
            fetchImpl: async () => new Response('{"errcode":45009}'),
          });
          assert.equal((await query(c.key)).state, "FAILED");
          assert.equal(
            (
              await prisma.pcLine.findUniqueOrThrow({
                where: { id: c.data.lineIds[0] },
              })
            ).status,
            "PENDING",
          );
        },
      );
    } finally {
      await prisma.pcNotification.deleteMany({
        where: { dedupeKey: { startsWith: marker } },
      });
      if (oldSettings)
        await prisma.pcSettings.update({
          where: { id: "purchasing" },
          data: oldSettings,
        });
      if (oldConfig)
        await prisma.pcPushConfig.update({
          where: { id: "purchasing" },
          data: oldConfig,
        });
      else
        await prisma.pcPushConfig.deleteMany({ where: { id: "purchasing" } });
      await prisma.pcPushClock.deleteMany({ where: { id: "purchasing" } });
      if (secret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = secret;
      await prisma.$disconnect();
    }
  },
);
