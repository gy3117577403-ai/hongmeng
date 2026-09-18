import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as XLSX from "xlsx";
import { CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { prisma } from "../lib/prisma";
import { s3, bucket } from "../lib/s3";
import { mutateQualityFixture } from "../lib/quality-fixture-service";
import { mutatePurchasing } from "../lib/purchasing-service";
import { randomUUID } from "node:crypto";

async function main() {
  const db = new URL(process.env.DATABASE_URL || "");
  if (process.env.QUALITY_FIXTURE_QA_ALLOW !== "disposable-fixture-runtime" || !db.pathname.includes("quality_fixture"))
    throw new Error("QA seed requires a named disposable quality_fixture database");
  const password = process.env.QUALITY_FIXTURE_QA_PASSWORD || "FixtureLocal619!";
  const names = [["qf-plan","计划验收"],["qf-supervisor","主管验收"],["qf-quality","质量验收"],["qf-buyer","采购验收"]];
  const users = [];
  for (const [username, displayName] of names) {
    const u = await prisma.user.upsert({ where: { username }, update: {}, create: { username, displayName, passwordHash: await bcrypt.hash(password, 10), laborRole: "ADMIN", mustChangePassword: false, isActive: true, accountStatus: "ACTIVE" } });
    if (!await prisma.userAccessGrant.findFirst({ where: { userId: u.id, profile: "ADMIN_GLOBAL", isActive: true } }))
      await prisma.userAccessGrant.create({ data: { userId: u.id, profile: "ADMIN_GLOBAL", scopeKey: "GLOBAL", grantType: "PRIMARY", isActive: true, effectiveFrom: new Date() } });
    users.push(u);
  }
  const settings = await prisma.qfSettings.findUnique({ where: { id: "quality-fixtures" } });
  await mutateQualityFixture({ action: "SAVE_SETTINGS", version: settings?.version, supervisorIds: [users[1].id], qualityIds: [users[2].id] }, users[0], randomUUID());
  const pc = await prisma.pcSettings.findUnique({ where: { id: "purchasing" } });
  await mutatePurchasing({ action: "SAVE_SETTINGS", version: pc?.version, reason: "本地独立验收配置", purchaseApproverIds: [users[3].id], buyerIds: [users[3].id], fundApproverIds: [users[3].id], financeIds: [users[3].id] }, users[0], randomUUID());
  const product = await prisma.drawingLibraryItem.upsert({ where: { libraryKey: "QF-UI-ACCEPTANCE" }, update: {}, create: { customerName: "本地验收客户", productName: "多芯连接线组件", specification: "HL-DT-2409-A", libraryKey: "QF-UI-ACCEPTANCE" } });
  const wo = await prisma.workOrder.upsert({ where: { code: "QF-UI-240919" }, update: {}, create: { code: "QF-UI-240919", customerName: product.customerName,
    productName: product.productName!, specification: product.specification, drawingLibraryItemId: product.id, stage: "frontend", status: "processing", processName: "导通",
    weekStartDate: new Date("2026-09-21T00:00:00+08:00"), productionTargetQty: 100, uncompletedQty: "100", completedQty: "0", planType: "managed_plan", planActive: true,
    processRoute: { create: { templateName: "验收导通工序", templateVersion: 1, status: "in_progress", version: 1, confirmedAt: new Date(), confirmedById: users[0].id,
      steps: { create: { processCode: "QF-CHECK", processName: "导通测试", stageGroup: "frontend", position: 1, sequenceGroup: 1, standardSource: "qa_fixture",
        timeBasis: "per_unit", unitLabel: "件", standardMillisecondsPerUnit: 30000, inputQty: 100, status: "current" } } } } } });
  try { await s3().send(new HeadBucketCommand({ Bucket: bucket() })); } catch { await s3().send(new CreateBucketCommand({ Bucket: bucket() })); }
  const dir = path.resolve("output/quality-fixture-qa"); await mkdir(dir, { recursive: true });
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), pg = pdf.addPage([842,595]);
  pg.drawText("HANG LIAN - LOCAL ACCEPTANCE DRAWING", { x: 45, y: 535, size: 21, font });
  pg.drawText("HL-DT-2409-A    Rev A    FOR QA ONLY", { x:45,y:490,size:16,font });
  pg.drawText("X1 / X2: DT-C01 (2pcs)      X3: DT-C02 (1pc)", { x:45,y:435,size:14,font });
  pg.drawRectangle({ x:70,y:200,width:180,height:130,borderWidth:2 }); pg.drawRectangle({ x:555,y:200,width:180,height:130,borderWidth:2 });
  for (let i=0;i<4;i++) pg.drawLine({ start:{x:250,y:220+i*25},end:{x:555,y:220+i*25},thickness:1 });
  pg.drawText("Pin to pin continuity verification", { x:270,y:150,size:14,font });
  await writeFile(path.join(dir,"acceptance-drawing.pdf"),await pdf.save());
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["物料名称","连接器型号","单台用量","单位","位号"],["连接器","DT-C01",2,"个","X1 X2"],["插座","DT-C02",1,"个","X3"],["导线","WIRE-22",8,"米",""],["合计","","","", ""],
  ]),"BOM");
  for (const bookType of ["xlsx","xls"] as const) await writeFile(path.join(dir,"acceptance-bom."+bookType),XLSX.write(book,{bookType,type:"buffer"}));
  await writeFile(path.join(dir,"fixture.json"),JSON.stringify({ users: users.map(u=>({id:u.id,username:u.username})),productId:product.id,workOrderId:wo.id },null,2));
  console.log(JSON.stringify({ok:true,product:product.specification,workOrder:wo.code,dir,accounts:names.map(n=>n[0])}));
}
main().finally(()=>prisma.$disconnect());
