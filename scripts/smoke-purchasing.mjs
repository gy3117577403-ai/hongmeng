import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import ExcelJS from "exceljs";
assert.equal(process.env.PURCHASING_QA_ALLOW, "disposable-purchasing-runtime");
const base = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
assert.ok(
  ["127.0.0.1", "localhost"].includes(new URL(base).hostname),
  "Only disposable local runtime is allowed",
);
const fixture = JSON.parse(
  await readFile(process.env.PURCHASING_QA_FIXTURE, "utf8"),
);
const login = await fetch(base + "/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    username: fixture.user.username,
    password: fixture.password,
  }),
});
assert.equal(login.status, 200, await login.text());
const cookie = login.headers.get("set-cookie")?.match(/hm_session=[^;]+/)?.[0];
assert.ok(cookie);
const checks = [];
async function api(path, body, key = randomUUID()) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      cookie,
      ...(body
        ? { "content-type": "application/json", "idempotency-key": key }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(j.ok, true, JSON.stringify(j));
  return j.data;
}
const op = (body) => api("/api/purchases", body);
const record = (id) => api("/api/purchases?record=" + id);
const entry = async (id) => {
  const d = await record(id);
  return { id, version: d.record.version };
};
const unauth = await fetch(base + "/api/purchases");
assert.equal(unauth.status, 401);
checks.push("login-required");
const initial = await api("/api/purchases");
await op({
  action: "SAVE_SETTINGS",
  version: initial.settings?.version,
  ownerId: fixture.user.id,
  purchaseApproverIds: [fixture.user.id],
  buyerIds: [fixture.user.id],
  fundApproverIds: [fixture.user.id],
  financeIds: [fixture.user.id],
  reason: "验收环境流程配置",
});
const created = await op({
  action: "SAVE_REQUEST",
  submit: true,
  purpose: "采购完整流程验收 " + fixture.marker,
  lines: [
    {
      name: "数显游标卡尺 " + fixture.marker,
      spec: "0–150 mm / 0.01 mm",
      unit: "把",
      quantity: 4,
      estimateCents: 80000,
      needDate: fixture.date,
      category: "生产工具",
      urgency: "URGENT",
    },
    {
      name: "防静电手套 " + fixture.marker,
      spec: "L 码",
      unit: "双",
      quantity: 10,
      estimateCents: 10000,
      needDate: fixture.date,
    },
  ],
});
const id = created.lineIds[0],
  second = created.lineIds[1];
await op({ action: "APPROVE_LINES", entries: [await entry(id)] });
await op({
  action: "RETURN_LINES",
  entries: [await entry(second)],
  reason: "请补充手套材质",
});
checks.push("partial-approval-return");
await op({
  action: "PURCHASE",
  entries: [{ ...(await entry(id)), actualCents: 80000 }],
  supplier: "精密工具验收供应商 " + fixture.marker,
  settlement: "MONTHLY",
  payee: "工具供应商",
  bank: "测试银行",
  account: "TEST-621700001234",
  eta: fixture.date,
  cycle: fixture.date.slice(0, 7),
  dueDate: fixture.date,
  contractNumber: "HT-" + fixture.marker,
});
let d = await record(id);
assert.equal(d.record.allocations.length, 0);
assert.equal(d.record.contractLines.length, 1);
const contractId = d.record.contractLines[0].contractId;
const contract = await fetch(
  base + "/workspace/purchases/contracts/" + contractId,
  { headers: { cookie } },
);
assert.equal(contract.status, 200);
assert.match(await contract.text(), /物品采购合同/);
checks.push("contract-snapshot-no-auto-funding");
const receipt = {
    action: "RECEIVE",
    entries: [{ ...(await entry(id)), quantity: 4 }],
    date: fixture.date,
    warehouse: "采购物资仓",
    location: "工具区 A-01",
  },
  key = randomUUID();
await api("/api/purchases", receipt, key);
await api("/api/purchases", receipt, key);
d = await record(id);
assert.equal(d.record.receivedQty, 4);
assert.equal(d.record.balances[0].onHand, 4);
checks.push("month-end-receipt-idempotency");
const fund = await op({
  action: "CREATE_FUND",
  entries: [await entry(id)],
  amountCents: 80000,
});
await op({ action: "APPROVE_FUNDS", entries: [await entry(fund.id)] });
for (const amountCents of [30000, 50000])
  await op({
    action: "PAY",
    ...(await entry(fund.id)),
    amountCents,
    date: fixture.date,
    source: "公司验收账户",
    reference: randomUUID(),
  });
d = await record(id);
assert.equal(d.record.paidCents, 80000);
checks.push("partial-payments");
const pdf = await PDFDocument.create();
pdf
  .addPage()
  .drawText("PURCHASING ACCEPTANCE INVOICE " + fixture.marker, {
    x: 40,
    y: 780,
    size: 14,
    font: await pdf.embedFont(StandardFonts.Helvetica),
  });
const bytes = await pdf.save();
const upload = new FormData();
upload.append(
  "file",
  new Blob([bytes], { type: "application/pdf" }),
  "invoice-" + fixture.marker + ".pdf",
);
const uploaded = await fetch(base + "/api/purchases/attachments", {
  method: "POST",
  headers: { cookie },
  body: upload,
});
const file = await uploaded.json();
assert.equal(uploaded.status, 200, JSON.stringify(file));
await op({
  action: "INVOICE",
  entries: [await entry(id)],
  kind: "NORMAL",
  number: "INV-" + fixture.marker,
  amountCents: 80000,
  date: fixture.date,
  attachmentIds: [file.data.id],
});
const attachment = await fetch(
  base + "/api/purchases/attachments?id=" + file.data.id,
  { headers: { cookie } },
);
assert.equal(attachment.status, 200);
const downloaded = Buffer.from(await attachment.arrayBuffer());
assert.equal(downloaded.subarray(0, 5).toString(), "%PDF-");
assert.equal(downloaded.length, bytes.length);
checks.push("s3-upload-invoice-download");
d = await record(id);
assert.ok(d.record.completedAt);
let stock = d.record.balances[0];
await op({
  action: "ISSUE",
  id: stock.id,
  version: stock.version,
  quantity: 1,
  person: "装配车间",
  reason: "检具领用",
});
d = await record(id);
stock = d.record.balances[0];
await op({
  action: "RESTOCK",
  id: stock.id,
  version: stock.version,
  quantity: 1,
  person: "装配车间",
  reason: "领用归还",
});
d = await record(id);
stock = d.record.balances[0];
const ret = await op({
  action: "RETURN_GOODS",
  ...(await entry(id)),
  kind: "STOCK",
  stockId: stock.id,
  stockVersion: stock.version,
  quantity: 1,
  amountCents: 20000,
  date: fixture.date,
  reason: "测量误差退货",
});
assert.equal(ret.refundDueCents, 20000);
checks.push("stock-issue-restock-return");
d = await record(id);
let returned = d.record.returns[0];
await op({
  action: "REFUND",
  id: returned.id,
  version: returned.version,
  amountCents: 20000,
  destination: "PERSON",
  date: fixture.date,
  reference: "供应商退至垫付人",
});
d = await record(id);
returned = d.record.returns[0];
assert.equal(d.record.refundedCents, 0);
await op({
  action: "REFUND_HANDOVER",
  id: returned.id,
  version: returned.version,
  amountCents: 20000,
  date: fixture.date,
  reference: "垫付人归还公司",
});
const redUpload = new FormData();
redUpload.append(
  "file",
  new Blob([bytes], { type: "application/pdf" }),
  "credit-" + fixture.marker + ".pdf",
);
const red = await fetch(base + "/api/purchases/attachments", {
  method: "POST",
  headers: { cookie },
  body: redUpload,
}).then((r) => r.json());
assert.equal(red.ok, true);
await op({
  action: "INVOICE",
  entries: [await entry(id)],
  kind: "CREDIT",
  number: "CREDIT-" + fixture.marker,
  amountCents: 20000,
  date: fixture.date,
  attachmentIds: [red.data.id],
});
d = await record(id);
assert.equal(d.record.payableCents, 60000);
assert.equal(d.record.invoiceCents, 60000);
assert.equal(d.record.refundedCents, 20000);
assert.equal(d.record.balances[0].onHand, 3);
assert.ok(d.record.completedAt);
checks.push("personal-refund-handover-credit-completion");
const xlsx = await fetch(
  base +
    "/api/purchases/export?view=all&q=" +
    encodeURIComponent(fixture.marker),
  { headers: { cookie } },
);
assert.equal(xlsx.status, 200);
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(await xlsx.arrayBuffer());
assert.equal(workbook.worksheets[0].rowCount, 3);
checks.push("real-filtered-excel");
const view = await fetch(base + "/workspace/purchases", {
  headers: { cookie },
});
assert.equal(view.status, 200);
assert.match(await view.text(), /采购工作台/);
checks.push("authenticated-workbench");
const output = process.env.PURCHASING_QA_OUTPUT || "purchasing-http.json";
await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  JSON.stringify(
    { ok: true, base, marker: fixture.marker, lineId: id, contractId, checks },
    null,
    2,
  ),
);
console.log(JSON.stringify({ ok: true, checks }));
