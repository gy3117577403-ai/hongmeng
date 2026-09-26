import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, degrees, rgb } from 'pdf-lib';
import sharp from 'sharp';
import { normalizeShippingReport, recommendShippingTemplate, type ShippingReportContext } from '../lib/shipping-report-domain';
import { generateShippingReportPdf } from '../lib/shipping-report-pdf';

const context: ShippingReportContext = {
  source: { lotId: 'lot-a' }, version: 3, shipmentVersion: null, customerName: '杭州益威电子有限公司',
  productName: '控制线束', specification: 'A35DR2-80600-V1', unit: '套', workOrderCode: 'SC-20260927-001',
  quantity: 12, maxQuantity: 20, quantityLocked: false, sourceLabel: '本次实收入库', sourceOrderNo: 'ORDER-271',
  eligible: true, ineligibleReason: '', recommendedTemplate: 'yiwei',
  drawings: [{ id: 'library:drawing-a', name: '产品原图.pdf', version: 'V1.0', mimeType: 'application/pdf', size: 100, updatedAt: '2026-09-27T00:00:00.000Z' }], reports: [],
};
const input = { template: 'yiwei', version: 3, customerName: '伪造的客户', specification: '伪造的规格', quantity: 12, orderNo: 'ORDER-271', reportDate: '2026-09-27', drawingId: '', lotNo: '260927-01' };

test('customer template matching is explicit, includes full names, and leaves ambiguous matches to the operator', () => {
  assert.equal(recommendShippingTemplate(' 深圳益威电子有限公司 '), 'yiwei');
  assert.equal(recommendShippingTemplate('杭州欣兴汇科技有限公司'), 'xinxinghui');
  assert.equal(recommendShippingTemplate('杭州昆泰'), 'general');
  assert.equal(recommendShippingTemplate('益威与欣兴汇'), null);
  assert.equal(recommendShippingTemplate(''), null);
});
test('template override cannot override the source customer, specification, product, or unit', () => {
  const report = normalizeShippingReport({ ...input, template: 'general', productName: '串产品', unit: '件' }, context);
  assert.equal(report.template, 'general'); assert.equal(report.recommendedTemplate, 'yiwei');
  assert.equal(report.customerName, context.customerName); assert.equal(report.specification, context.specification);
  assert.equal(report.productName, context.productName); assert.equal(report.unit, '套');
});
test('public stock requires an explicit report customer without changing stock ownership', () => {
  assert.throws(() => normalizeShippingReport({ ...input, customerName: '' }, { ...context, customerName: '' }), /客户/);
  assert.equal(normalizeShippingReport({ ...input, customerName: '欣兴汇' }, { ...context, customerName: '' }).customerName, '欣兴汇');
});
test('unreceived, changed and oversubscribed sources do not generate reports', () => {
  assert.throws(() => normalizeShippingReport(input, { ...context, eligible: false, ineligibleReason: '未入库' }), /未入库/);
  assert.throws(() => normalizeShippingReport({ ...input, version: 2 }, context), /更新/);
  for (const quantity of [0, -1, 1.5, '', 21, Infinity]) assert.throws(() => normalizeShippingReport({ ...input, quantity }, context));
});
test('dispatch report quantity and version stay bound to the selected shipment', () => {
  const dispatch = { ...context, source: { lotId: 'lot-a', shipmentId: 'shipment-a' }, shipmentVersion: 4, quantity: 7, maxQuantity: 7, quantityLocked: true };
  assert.throws(() => normalizeShippingReport({ ...input, shipmentVersion: 4, quantity: 6 }, dispatch), /明细一致/);
  assert.throws(() => normalizeShippingReport({ ...input, shipmentVersion: 3, quantity: 7 }, dispatch), /更新/);
  assert.equal(normalizeShippingReport({ ...input, shipmentVersion: 4, quantity: 7 }, dispatch).quantity, 7);
});
test('drawing must belong to the product and must still be the displayed version', () => {
  assert.throws(() => normalizeShippingReport({ ...input, drawingId: 'library:other' }, context), /不属于/);
  assert.throws(() => normalizeShippingReport({ ...input, drawingId: context.drawings[0].id, drawingUpdatedAt: 'old' }, context), /版本已更新/);
  const report = normalizeShippingReport({ ...input, drawingId: context.drawings[0].id, drawingUpdatedAt: context.drawings[0].updatedAt, drawingPage: 2 }, context);
  assert.equal(report.drawing?.page, 2);
  assert.equal(normalizeShippingReport({ ...input, template: 'xinxinghui', drawingId: 'library:other' }, context).drawing, null);
});
test('invalid dates are rejected and blank result fields are never accepted as inspection evidence', () => {
  assert.throws(() => normalizeShippingReport({ ...input, reportDate: '2026-02-30' }, context), /日期无效/);
  const report = normalizeShippingReport({ ...input, result: '合格', inspector: '张三' }, context);
  assert.equal('result' in report, false); assert.equal('inspector' in report, false);
});
test('all three templates create self-contained one-page A4 PDFs with correct issuer metadata', async () => {
  for (const template of ['general', 'yiwei', 'xinxinghui']) {
    const snapshot = normalizeShippingReport({ ...input, template }, context);
    const { bytes } = await generateShippingReportPdf(snapshot, undefined, 'CHBG-QA-001');
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 1); assert.ok(Math.abs(pdf.getPage(0).getWidth() - 595.276) < 0.1);
    assert.ok(Math.abs(pdf.getPage(0).getHeight() - 841.89) < 0.1);
    assert.equal(pdf.getAuthor(), template === 'xinxinghui' ? '杭州迈斯嘉电子科技有限公司' : '杭州杭连电子有限公司');
    assert.equal(pdf.getTitle(), 'CHBG-QA-001 · A35DR2-80600-V1');
    assert.equal(pdf.getSubject(), '杭州益威电子有限公司 · 12 套'); assert.ok(bytes.length > 15000 && bytes.length < 400000, 'CJK report embeds only required glyphs');
  }
});

test('camera originals honor EXIF orientation and embed actual image pixels', async () => {
  const body = await sharp({ create: { width: 40, height: 80, channels: 3, background: '#ec6b14' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const s = normalizeShippingReport({ ...input, drawingId: context.drawings[0].id, drawingUpdatedAt: context.drawings[0].updatedAt, drawingPage: 1 }, context);
  const result = await generateShippingReportPdf(s, { body, mimeType: 'image/jpeg' });
  assert.equal(result.drawingPages, 1);
  const pdf = await PDFDocument.load(result.bytes);
  const images = pdf.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
  const image = pdf.context.lookup(images.entries()[0][1]);
  assert.ok(image instanceof PDFRawStream);
  assert.equal(image.dict.lookup(PDFName.of('Subtype'), PDFName).asString(), '/Image');
  assert.equal(image.dict.lookup(PDFName.of('Width'), PDFNumber).asNumber(), 80);
  assert.equal(image.dict.lookup(PDFName.of('Height'), PDFNumber).asNumber(), 40);
});
test('original PDF page selection and landscape rotation embed without adding pages or stretching the report', async () => {
  const source = await PDFDocument.create(); source.addPage([200, 400]); const rotated = source.addPage([200, 400]); rotated.setRotation(degrees(90));
  rotated.drawRectangle({ x: 0, y: 0, width: 30, height: 300, color: rgb(1, 0, 0) });
  const body = await source.save();
  const s = normalizeShippingReport({ ...input, drawingId: context.drawings[0].id, drawingUpdatedAt: context.drawings[0].updatedAt, drawingPage: 2 }, context);
  const result = await generateShippingReportPdf(s, { body, mimeType: 'application/pdf' });
  assert.equal(result.drawingPages, 2); assert.equal((await PDFDocument.load(result.bytes)).getPageCount(), 1);
  await assert.rejects(generateShippingReportPdf({ ...s, drawing: { ...s.drawing!, page: 3 } }, { body, mimeType: 'application/pdf' }), /共 2 页/);
  await assert.rejects(generateShippingReportPdf(s, { body: Buffer.from('corrupt'), mimeType: 'application/pdf' }), /无法嵌入/);
});
