import assert from 'node:assert/strict';
import test from 'node:test';
import { degrees, PDFDocument, rgb } from 'pdf-lib';
import sharp from 'sharp';
import { buildWorkOrderPrintPacket, type WorkOrderPrintPacketRecord } from '../lib/work-order-print-packet';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function sourceSop() {
  const pdf = await PDFDocument.create();
  const landscape = pdf.addPage([842, 595]);
  landscape.drawRectangle({ x: 24, y: 24, width: 300, height: 120, color: rgb(0.9, 0.2, 0.1) });
  const rotated = pdf.addPage([595, 842]);
  rotated.setRotation(degrees(90));
  rotated.drawRectangle({ x: 40, y: 40, width: 180, height: 220, color: rgb(0.1, 0.4, 0.9) });
  return pdf.save({ useObjectStreams: false });
}

function duplexRecord(): WorkOrderPrintPacketRecord {
  return {
    printId: 'print-1',
    mode: 'TRAVELER_SOP_DUPLEX',
    items: [
      { material: 'TRAVELER', copies: 1, fileId: null },
      { material: 'SOP', copies: 1, fileId: 'sop-1' },
    ],
  };
}

test('separate historical print records of one SOP retain their own frozen directions', async () => {
  const first = duplexRecord();
  const second = { ...duplexRecord(), printId: 'print-2', snapshot: { documentOrientations: { 'sop-1': { revision: 4, pageRotations: { '1': 90, '2': 270 } } } } };
  const result = await buildWorkOrderPrintPacket({ records: [first, second], target: 'sop', sourceFiles: new Map([['sop-1', { bytes: await sourceSop(), fileName: 'SOP.pdf', mimeType: 'application/pdf' }]]) });
  const pdf = await PDFDocument.load(result.bytes);
  assert.deepEqual(pdf.getPages().map(page => page.getRotation().angle), [0, 90, 90, 0]);
});

test('duplex packet keeps native SOP page sizes and rotation and adds only a pairing blank', async () => {
  const result = await buildWorkOrderPrintPacket({
    records: [duplexRecord()],
    target: 'all',
    travelerImages: new Map([['print-1', [ONE_PIXEL_PNG]]]),
    sourceFiles: new Map([['sop-1', {
      bytes: await sourceSop(),
      fileName: 'SOP-v2.pdf',
      mimeType: 'application/pdf',
    }]]),
  });
  const packet = await PDFDocument.load(result.bytes);
  assert.equal(result.pageCount, 4);
  assert.equal(packet.getPageCount(), 4);
  assert.ok(Math.abs(packet.getPage(0).getWidth() - 595.28) < 0.1);
  assert.ok(Math.abs(packet.getPage(0).getHeight() - 841.89) < 0.1);
  assert.equal(packet.getPage(1).getWidth(), 842);
  assert.equal(packet.getPage(1).getHeight(), 595);
  assert.equal(packet.getPage(2).getRotation().angle, 90);
  assert.equal(packet.getPage(3).getRotation().angle, 90);
  assert.match(result.hash, /^[a-f0-9]{64}$/);
});

test('separate SOP packet does not force A4 portrait or insert duplex blanks', async () => {
  const result = await buildWorkOrderPrintPacket({
    records: [duplexRecord()],
    target: 'sop',
    sourceFiles: new Map([['sop-1', {
      bytes: await sourceSop(),
      fileName: 'SOP-v2.pdf',
      mimeType: 'application/pdf',
    }]]),
  });
  const packet = await PDFDocument.load(result.bytes);
  assert.equal(packet.getPageCount(), 2);
  assert.equal(packet.getPage(0).getWidth(), 842);
  assert.equal(packet.getPage(0).getHeight(), 595);
  assert.equal(packet.getPage(1).getRotation().angle, 90);
});

test('duplex packet converts a landscape PNG SOP into an A4 landscape page', async () => {
  const png = await sharp({
    create: { width: 1200, height: 600, channels: 4, background: { r: 245, g: 120, b: 30, alpha: 0.8 } },
  }).png().toBuffer();
  const result = await buildWorkOrderPrintPacket({
    records: [duplexRecord()],
    target: 'all',
    travelerImages: new Map([['print-1', [ONE_PIXEL_PNG]]]),
    sourceFiles: new Map([['sop-1', {
      bytes: png,
      fileName: '现场SOP.png',
      mimeType: 'image/png',
      imagePaperSize: 'A4',
    }]]),
  });
  const packet = await PDFDocument.load(result.bytes);
  assert.equal(packet.getPageCount(), 2);
  assert.ok(Math.abs(packet.getPage(1).getWidth() - 841.89) < 0.1);
  assert.ok(Math.abs(packet.getPage(1).getHeight() - 595.28) < 0.1);
});

test('multi-page traveler packet preserves every generated traveler page in order', async () => {
  const result = await buildWorkOrderPrintPacket({
    records: [{
      printId: 'print-1',
      mode: 'TRAVELER_ONLY',
      items: [{ material: 'TRAVELER', copies: 1, fileId: null }],
    }],
    target: 'traveler',
    travelerImages: new Map([['print-1', [ONE_PIXEL_PNG, ONE_PIXEL_PNG]]]),
  });
  const packet = await PDFDocument.load(result.bytes);
  assert.equal(result.pageCount, 2);
  assert.equal(packet.getPageCount(), 2);
  for (const page of packet.getPages()) {
    assert.ok(Math.abs(page.getWidth() - 595.28) < 0.1);
    assert.ok(Math.abs(page.getHeight() - 841.89) < 0.1);
  }
});

test('duplex packet pairs two traveler pages and two SOP pages without an extra blank', async () => {
  const result = await buildWorkOrderPrintPacket({
    records: [duplexRecord()],
    target: 'all',
    travelerImages: new Map([['print-1', [ONE_PIXEL_PNG, ONE_PIXEL_PNG]]]),
    sourceFiles: new Map([['sop-1', {
      bytes: await sourceSop(),
      fileName: 'SOP-v2.pdf',
      mimeType: 'application/pdf',
    }]]),
  });
  const packet = await PDFDocument.load(result.bytes);
  assert.equal(result.pageCount, 4);
  assert.equal(packet.getPageCount(), 4);
});

test('traveler and quality warning packet keeps the traveler first and emits every warning page', async () => {
  const result = await buildWorkOrderPrintPacket({
    records: [{
      printId: 'print-warning-1',
      mode: 'TRAVELER_QUALITY_WARNING',
      items: [
        { material: 'TRAVELER', copies: 1, fileId: null },
        { material: 'QUALITY_WARNING', copies: 1, fileId: null },
      ],
    }],
    target: 'traveler_warning',
    travelerImages: new Map([['print-warning-1', [ONE_PIXEL_PNG]]]),
    warningImages: new Map([['print-warning-1', [ONE_PIXEL_PNG, ONE_PIXEL_PNG]]]),
  });
  const packet = await PDFDocument.load(result.bytes);
  assert.equal(result.pageCount, 3);
  assert.equal(packet.getPageCount(), 3);
  assert.equal(packet.getTitle(), '生产流转单与异常警示');
  for (const page of packet.getPages()) {
    assert.ok(Math.abs(page.getWidth() - 595.28) < 0.1);
    assert.ok(Math.abs(page.getHeight() - 841.89) < 0.1);
  }
});

test('traveler and quality warning packet fails closed when warning evidence is missing', async () => {
  await assert.rejects(
    buildWorkOrderPrintPacket({
      records: [{
        printId: 'print-warning-missing',
        mode: 'TRAVELER_QUALITY_WARNING',
        items: [
          { material: 'TRAVELER', copies: 1, fileId: null },
          { material: 'QUALITY_WARNING', copies: 1, fileId: null },
        ],
      }],
      target: 'traveler_warning',
      travelerImages: new Map([['print-warning-missing', [ONE_PIXEL_PNG]]]),
    }),
    (error: unknown) => error instanceof Error
      && error.name === 'WorkOrderPrintPacketError'
      && 'code' in error
      && error.code === 'PRINT_PACKET_WARNING_MISSING',
  );
});
