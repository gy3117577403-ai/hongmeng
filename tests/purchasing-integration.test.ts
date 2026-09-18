import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { mutatePurchasing, type PcActor } from "../lib/purchasing-service";
import { loadPurchasing, purchasingDetail } from "../lib/purchasing-queries";
import type { PcInput } from "../lib/purchasing-domain";
const skip = process.env.RUN_DB_INTEGRATION !== "1";
test(
  "purchasing database lifecycle, accounting, conflict and rollback acceptance",
  { skip },
  async (t) => {
    const marker = "PCQ-" + randomUUID().slice(0, 8),
      date = new Date().toLocaleDateString("sv-SE", {
        timeZone: "Asia/Shanghai",
      });
    const actor = await prisma.user.create({
      data: {
        username: marker,
        displayName: "采购验收",
        passwordHash: "not-a-login-hash",
        laborRole: "ADMIN",
      },
    });
    const other = await prisma.user.create({
      data: {
        username: marker + "-other",
        displayName: "其他员工",
        passwordHash: "not-a-login-hash",
      },
    });
    const run = async (
      body: PcInput,
      key = randomUUID(),
      who: PcActor = actor,
    ) => (await mutatePurchasing(body, who, key)) as Record<string, unknown>;
    const s = await prisma.pcSettings.findUnique({
      where: { id: "purchasing" },
    });
    await run({
      action: "SAVE_SETTINGS",
      ownerId: actor.id,
      version: s?.version,
      reason: "独立数据库集成验收",
      purchaseApproverIds: [actor.id],
      buyerIds: [actor.id],
      fundApproverIds: [actor.id],
      financeIds: [actor.id],
    });
    const line = (id: string) =>
        prisma.pcLine.findUniqueOrThrow({ where: { id } }),
      fund = (id: string) => prisma.pcFund.findUniqueOrThrow({ where: { id } });
    const entry = async (id: string) => {
      const p = await line(id);
      return { id, version: p.version };
    };
    const create = async (n = 1) => {
      const result = await run({
        action: "SAVE_REQUEST",
        submit: true,
        purpose: marker,
        lines: Array.from({ length: n }, (_, i) => ({
          name: marker + " 物资 " + i,
          spec: "M8",
          unit: "件",
          quantity: 10,
          estimateCents: 10000,
          needDate: date,
        })),
      });
      return result.lineIds as string[];
    };
    const approve = async (ids: string[]) =>
      run({
        action: "APPROVE_LINES",
        entries: await Promise.all(ids.map(entry)),
      });
    const purchase = async (
      ids: string[],
      settlement = "CORPORATE",
      supplier = marker,
    ) =>
      run({
        action: "PURCHASE",
        entries: await Promise.all(
          ids.map(async (id) => ({ ...(await entry(id)), actualCents: 10000 })),
        ),
        settlement,
        supplier,
        payee: "采购验收",
        payeeUserId: actor.id,
        bank: "验收银行",
        account: "TEST-9001",
        eta: date,
        cycle: date.slice(0, 7),
        dueDate: date,
      });
    const fundFor = async (
      ids: string[],
      amountCents: number,
      adjustment = "NONE",
    ) =>
      run({
        action: "CREATE_FUND",
        entries: await Promise.all(ids.map(entry)),
        amountCents,
        adjustment,
        reason: "本次分次付款",
      });
    const fundAction = async (
      action: string,
      id: string,
      extra: PcInput = {},
    ) =>
      run({
        action,
        id,
        version: (await fund(id)).version,
        reason: "验收操作",
        ...extra,
      });
    const payment = async (id: string, amountCents: number) =>
      fundAction("PAY", id, {
        amountCents,
        date,
        source: "公司测试账户",
        reference: randomUUID(),
      });
    const receive = async (id: string, quantity: number) =>
      run({
        action: "RECEIVE",
        entries: [{ ...(await entry(id)), quantity }],
        date,
        warehouse: "采购物资仓",
        location: "A-01",
      });
    const attachment = async () => {
      const f = await prisma.pcAttachment.create({
        data: {
          objectKey: "test/" + randomUUID(),
          originalName: "测试票据.pdf",
          contentType: "application/pdf",
          size: 10,
          actorId: actor.id,
          actorName: "采购验收",
        },
      });
      return f.id;
    };
    const invoice = async (id: string, amountCents: number, kind = "NORMAL") =>
      run({
        action: "INVOICE",
        entries: [await entry(id)],
        amountCents,
        kind,
        number: randomUUID(),
        date,
        attachmentIds: [await attachment()],
      });
    await t.test(
      "partial approval and stale batch are atomic; resubmission preserves passed lines",
      async () => {
        const ids = await create(3);
        await approve([ids[0]]);
        await run({
          action: "RETURN_LINES",
          entries: [await entry(ids[1])],
          reason: "规格需补充",
        });
        const before = await line(ids[2]);
        await assert.rejects(approve([ids[2], ids[0]]), /待审批/);
        assert.equal((await line(ids[2])).status, "PENDING");
        assert.equal((await line(ids[2])).version, before.version);
        await assert.rejects(
          run(
            { action: "APPROVE_LINES", entries: [await entry(ids[2])] },
            randomUUID(),
            other,
          ),
          /职责/,
        );
        const returned = await line(ids[1]),
          req = await prisma.pcRequest.findUniqueOrThrow({
            where: { id: returned.requestId },
          });
        await run({
          action: "SAVE_REQUEST",
          requestId: req.id,
          version: req.version,
          applicantId: actor.id,
          purpose: marker,
          submit: true,
          lines: [{ ...returned, spec: "M8 改进版" }],
        });
        assert.equal((await line(ids[0])).status, "APPROVED");
        assert.equal((await line(ids[1])).status, "PENDING");
        const stale = await entry(ids[2]);
        await approve([ids[2]]);
        await assert.rejects(
          run({ action: "RETURN_LINES", entries: [stale], reason: "旧版本" }),
          /已被更新/,
        );
      },
    );
    await t.test(
      "month-end receiving can precede payments; funds do not auto-create and repeated receipt is idempotent",
      async () => {
        const [id] = await create();
        await approve([id]);
        await purchase([id], "MONTHLY");
        assert.equal(
          await prisma.pcFundAllocation.count({ where: { lineId: id } }),
          0,
        );
        const body = {
            action: "RECEIVE",
            entries: [{ ...(await entry(id)), quantity: 10 }],
            date,
            warehouse: "采购物资仓",
            location: "A-01",
          },
          key = randomUUID();
        await run(body, key);
        await run(body, key);
        assert.equal((await line(id)).receivedQty, 10);
        const result = await fundFor([id], 4000, "PARTIAL");
        await fundAction("APPROVE_FUNDS", String(result.id));
        await payment(String(result.id), 1500);
        await payment(String(result.id), 2500);
        assert.equal((await line(id)).payableCents, 10000);
        assert.equal((await line(id)).paidCents, 4000);
        await assert.rejects(payment(String(result.id), 1), /已经批准/);
        const second = await fundFor([id], 6000);
        await fundAction("APPROVE_FUNDS", String(second.id));
        await payment(String(second.id), 6000);
        await invoice(id, 10000);
        assert.ok((await line(id)).completedAt);
        const loaded = await loadPurchasing(
          { view: "completed", q: marker },
          actor,
        );
        assert.ok(loaded.rows.some((r) => r.id === id));
      },
    );
    await t.test(
      "partial-paid return requires finance close, respects issued stock, and personal refunds are not company funds",
      async () => {
        const [id] = await create();
        await approve([id]);
        await purchase([id]);
        await receive(id, 10);
        const f = await fundFor([id], 10000);
        const fid = String(f.id);
        await fundAction("APPROVE_FUNDS", fid);
        await payment(fid, 6000);
        await invoice(id, 10000);
        const stock = () =>
          prisma.pcStockBalance.findFirstOrThrow({ where: { lineId: id } });
        const ret = async (q: number, amount: number) => {
          const b = await stock();
          return run({
            action: "RETURN_GOODS",
            ...(await entry(id)),
            kind: "STOCK",
            stockId: b.id,
            stockVersion: b.version,
            quantity: q,
            amountCents: amount,
            reason: "质量退货",
            date,
          });
        };
        await assert.rejects(ret(7, 7000), /先在关联资金单/);
        await fundAction("CLOSE_FUND", fid);
        const b = await stock();
        await run({
          action: "ISSUE",
          id: b.id,
          version: b.version,
          quantity: 4,
          reason: "领用测试",
          person: "使用人",
        });
        await assert.rejects(ret(7, 7000), /可退在库/);
        const out = await stock();
        await run({
          action: "RESTOCK",
          id: out.id,
          version: out.version,
          quantity: 4,
          reason: "退库后退供应商",
          person: "使用人",
        });
        const result = await ret(7, 7000);
        assert.equal(result.refundDueCents, 3000);
        assert.equal((await stock()).onHand, 3);
        assert.equal((await line(id)).payableCents, 3000);
        let r = await prisma.pcReturn.findUniqueOrThrow({
          where: { id: String(result.id) },
        });
        await run({
          action: "REFUND",
          id: r.id,
          version: r.version,
          amountCents: 3000,
          destination: "PERSON",
          date,
          reference: "个人到账",
        });
        assert.equal((await line(id)).refundedCents, 0);
        assert.equal((await line(id)).completedAt, null);
        r = await prisma.pcReturn.findUniqueOrThrow({ where: { id: r.id } });
        await run({
          action: "REFUND_HANDOVER",
          id: r.id,
          version: r.version,
          amountCents: 3000,
          date,
          reference: "已归还公司",
        });
        assert.equal((await line(id)).refundedCents, 3000);
        assert.equal((await line(id)).completedAt, null);
        await invoice(id, 7000, "CREDIT");
        assert.ok((await line(id)).completedAt);
        const d = await purchasingDetail(id, actor);
        assert.equal(d.kind, "line");
        assert.ok(
          (
            await loadPurchasing({ view: "documents", q: marker }, actor)
          ).rows.every((row) => row.id !== id),
        );
      },
    );
    await t.test(
      "fund grouping rejects different vendors but allows same-person advances across vendors",
      async () => {
        const ids = await create(2);
        await approve(ids);
        await purchase([ids[0]], "CORPORATE", marker + "A");
        await purchase([ids[1]], "CORPORATE", marker + "B");
        await assert.rejects(fundFor(ids, 20000), /需拆分/);
        const advances = await create(2);
        await approve(advances);
        await purchase([advances[0]], "ADVANCE", marker + "A");
        await purchase([advances[1]], "ADVANCE", marker + "B");
        const f = await fundFor(advances, 20000);
        assert.equal(
          await prisma.pcFundAllocation.count({
            where: { fundId: String(f.id) },
          }),
          2,
        );
        await fundAction("WITHDRAW_FUND", String(f.id));
        assert.equal((await line(advances[0])).reservedCents, 0);
      },
    );
    await t.test(
      "contract threshold uses per-item total; concurrent funding cannot over-reserve",
      async () => {
        const [id] = await create();
        await approve([id]);
        const base = {
          action: "PURCHASE",
          entries: [{ ...(await entry(id)), actualCents: 50000 }],
          settlement: "CORPORATE",
          supplier: marker,
          payee: "公司",
          bank: "银行",
          account: "1",
          eta: date,
        };
        await assert.rejects(run(base), /合同编号/);
        await run({ ...base, contractNumber: marker + "-HT" });
        assert.equal(
          await prisma.pcContractLine.count({ where: { lineId: id } }),
          1,
        );
        const body = {
          action: "CREATE_FUND",
          entries: [await entry(id)],
          amountCents: 50000,
        };
        const results = await Promise.allSettled([run(body), run(body)]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal((await line(id)).reservedCents, 50000);
        await assert.rejects(
          run({
            action: "RETURN_GOODS",
            ...(await entry(id)),
            kind: "UNRECEIVED",
            quantity: 10,
            amountCents: 50000,
            date,
            reason: "未收退货",
          }),
          /先在关联资金单/,
        );
        const f = await prisma.pcFundAllocation.findFirstOrThrow({
          where: { lineId: id, active: true },
        });
        await fundAction("WITHDRAW_FUND", f.fundId);
        await run({
          action: "RETURN_GOODS",
          ...(await entry(id)),
          kind: "UNRECEIVED",
          quantity: 10,
          amountCents: 50000,
          date,
          reason: "未收退货",
        });
        assert.equal(
          await prisma.pcStockBalance.count({ where: { lineId: id } }),
          0,
        );
        assert.ok((await line(id)).completedAt);
      },
    );
    await t.test(
      "offline payment cannot duplicate an unfinished funding application and notifications persist",
      async () => {
        const [id] = await create();
        await approve([id]);
        await purchase([id]);
        const f = await fundFor([id], 5000, "PARTIAL");
        await assert.rejects(
          run({
            action: "OFFLINE_PAYMENT",
            entries: [await entry(id)],
            amountCents: 5000,
            reason: "线下已付",
            date,
            reference: "test",
            source: "test",
          }),
          /已有未结束/,
        );
        await fundAction("WITHDRAW_FUND", String(f.id));
        await run({
          action: "OFFLINE_PAYMENT",
          entries: [await entry(id)],
          amountCents: 3000,
          reason: "线下已付",
          date,
          reference: "test",
          source: "test",
        });
        assert.equal((await line(id)).paidCents, 3000);
        assert.equal((await line(id)).payableCents, 10000);
        assert.ok(
          await prisma.systemNotification.count({
            where: { sourceType: "PURCHASING", actorId: actor.id },
          }),
        );
        const results = await loadPurchasing(
          {
            view: "funds",
            q: "DOES-NOT-EXIST-" + marker,
            mine: true,
            follow: "history",
          },
          actor,
        );
        assert.equal(results.total, 0);
      },
    );
    await t.test('draft edits allocate unique line numbers and void keeps historical records', async () => {
        const value={name:marker+' 草稿',spec:'M8',unit:'件',quantity:2,estimateCents:1000,needDate:date};
        const first=await run({action:'SAVE_REQUEST',submit:false,purpose:marker,lines:[value,value]});
        const requestId=String(first.id);
        const append=async()=>{const req=await prisma.pcRequest.findUniqueOrThrow({where:{id:requestId},include:{lines:{where:{status:'DRAFT'}}}});await run({action:'SAVE_REQUEST',requestId,version:req.version,purpose:marker,submit:false,lines:[...req.lines,value]});};
        await append();await append();
        const req=await prisma.pcRequest.findUniqueOrThrow({where:{id:requestId},include:{lines:true}});
        assert.equal(req.lines.length,4);assert.equal(new Set(req.lines.map(l=>l.number)).size,4);
        await run({action:'VOID_LINES',entries:req.lines.map(l=>({id:l.id,version:l.version})),reason:'验收作废'});
        assert.equal((await prisma.pcRequest.findUniqueOrThrow({where:{id:requestId}})).status,'VOID');
        assert.equal(await prisma.pcLine.count({where:{requestId,status:'VOID'}}),4);
    });
    await prisma.$disconnect();
  },
);
