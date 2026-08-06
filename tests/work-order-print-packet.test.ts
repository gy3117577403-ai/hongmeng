import assert from 'node:assert/strict';
import test from 'node:test';
import { degrees, PDFDocument, rgb } from 'pdf-lib';
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

test('duplex packet keeps native SOP page sizes and rotation and adds only a pairing blank', async () => {
  const result = await buildWorkOrderPrintPacket({
    records: [duplexRecord()],
    target: 'all',
    travelerImages: new Map([['print-1', ONE_PIXEL_PNG]]),
    sourcePdfs: new Map([['sop-1', await sourceSop()]]),
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
    sourcePdfs: new Map([['sop-1', await sourceSop()]]),
  });
  const packet = await PDFDocument.load(result.bytes);
  assert.equal(packet.getPageCount(), 2);
  assert.equal(packet.getPage(0).getWidth(), 842);
  assert.equal(packet.getPage(0).getHeight(), 595);
  assert.equal(packet.getPage(1).getRotation().angle, 90);
});
