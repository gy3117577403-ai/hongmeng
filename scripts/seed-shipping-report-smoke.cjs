// Disposable acceptance fixture only; never execute against a business database.
const { PrismaClient } = require('@prisma/client');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { createFixture } = require('./seed-finished-goods-smoke.cjs');
const fs = require('node:fs');
async function main() {
  if (process.env.SHIPPING_QA_ALLOW !== 'disposable-shipping-reports') throw Error('Disposable shipping report guard required');
  if (!['127.0.0.1', 'localhost'].includes(new URL(process.env.DATABASE_URL).hostname)) throw Error('Loopback database required');
  if (!['127.0.0.1', 'localhost'].includes(new URL(process.env.S3_ENDPOINT).hostname)) throw Error('Loopback storage required');
  const db = new PrismaClient();
  const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } });
  try {
    process.env.FINISHED_GOODS_QA_ALLOW = 'disposable-finished-goods-runtime';
    const f = await createFixture(db, 5);
    const scopes = ['MODULES:ON', 'MODULE:materials:READ'];
    await db.userAccessGrant.deleteMany({ where: { userId: f.user.id } });
    for (const scopeKey of scopes) await db.userAccessGrant.create({ data: { userId: f.user.id, profile: 'MODULE_ACCESS', scopeKey } });
    const category = await db.resourceCategory.upsert({ where: { code: 'drawing' }, create: { code: 'drawing', name: '原图', sortOrder: 1 }, update: {} });
    const names = ['深圳益威电子有限公司', '杭州欣兴汇科技有限公司', '杭州昆泰自动化有限公司', '未入库验收客户', ''];
    const specs = ['YW-228152-1-1M', 'XXH-D014503-8305-V01', 'KTP4503-6M', 'PENDING-001', 'PUBLIC-001'];
    for (let i = 0; i < f.lots.length; i++) {
      const lot = f.lots[i], customerName = names[i], specification = specs[i], orderNo = 'SO-20260927-' + (i + 1);
      await db.workOrder.update({ where: { id: lot.workOrderId }, data: { customerName, specification, productName: '控制连接线束', sourceOrderNo: orderNo } });
      await db.fgLot.update({ where: { id: lot.id }, data: { customerName, specification, productName: '控制连接线束', unit: '套', ownerType: customerName ? 'CUSTOMER' : 'PUBLIC' } });
      Object.assign(lot, { customerName, specification, orderNo });
      if (i < 2) {
        const library = await db.drawingLibraryItem.create({ data: { customerName, specification, productName: '控制连接线束', libraryKey: f.marker + '-drawing-' + i } });
        await db.workOrder.update({ where: { id: lot.workOrderId }, data: { drawingLibraryItemId: library.id } });
        const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
        for (let p = 1; p <= 2; p++) {
          const page = pdf.addPage([800, 420]); page.drawRectangle({ x: 24, y: 24, width: 752, height: 372, borderColor: rgb(0.1, 0.2, 0.3), borderWidth: 2 });
          page.drawText(specification + ' / ORIGINAL PAGE ' + p, { x: 42, y: 358, size: 22, font });
          page.drawLine({ start: { x: 100, y: 190 }, end: { x: 700, y: 190 }, thickness: 8, color: rgb(.15, .25, .33) });
          page.drawRectangle({ x: 65, y: 145, width: 80, height: 90, color: rgb(.85, .43, .15) });
          page.drawRectangle({ x: 660, y: 145, width: 75, height: 90, color: rgb(.3, .48, .63) });
          page.drawText('600 +/- 8 mm', { x: 300, y: 230, size: 17, font });
          page.drawText('QA FIXTURE - NOT A PRODUCTION DRAWING', { x: 42, y: 48, size: 12, font });
          if (p === 2) page.setRotation(degrees(90));
        }
        const body = Buffer.from(await pdf.save()), key = 'qa/shipping/' + f.marker + '/' + i + '.pdf';
        await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: body, ContentType: 'application/pdf' }));
        const file = await db.drawingLibraryFile.create({ data: { libraryItemId: library.id, categoryId: category.id, originalName: specification + '-原图.pdf', mimeType: 'application/pdf', objectKey: key, size: body.length } });
        lot.drawingId = file.id;
      }
    }
    const target = process.env.SHIPPING_QA_FIXTURE;
    if (!target) throw Error('Fixture path required');
    fs.writeFileSync(target, JSON.stringify(f));
    console.log('Prepared 5 isolated shipping report products, 2 original drawings and a read-only warehouse account.');
  } finally { await db.$disconnect(); s3.destroy(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
