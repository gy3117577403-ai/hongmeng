import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { degrees, PDFDocument } from 'pdf-lib';
import sharp, { type Sharp } from 'sharp';
import {
  buildPrintableSourcePdf,
  PrintableDocumentError,
  printableSourceFormat,
  readPrintableSourceStream,
} from '../lib/printable-document';

test('printable source classification covers every file type accepted by the platform', () => {
  assert.equal(printableSourceFormat('route.pdf', 'application/pdf'), 'pdf');
  assert.equal(printableSourceFormat('photo.jpg', 'image/jpeg'), 'jpg');
  assert.equal(printableSourceFormat('photo.jpeg', 'image/jpeg'), 'jpg');
  assert.equal(printableSourceFormat('instruction.png', 'image/png'), 'png');
  assert.equal(printableSourceFormat('instruction.webp', 'image/webp'), 'webp');
  assert.equal(printableSourceFormat('macro.docm', 'application/vnd.ms-word.document.macroEnabled.12'), null);
});

test('PDF sources retain their native page size and rotation', async () => {
  const source = await PDFDocument.create();
  source.addPage([842, 595]);
  const rotated = source.addPage([595, 842]);
  rotated.setRotation(degrees(90));
  const result = await buildPrintableSourcePdf({
    bytes: await source.save({ useObjectStreams: false }),
    fileName: '原始SOP.pdf',
    mimeType: 'application/pdf',
  });
  const output = await PDFDocument.load(result.bytes);
  assert.equal(result.pageCount, 2);
  assert.equal(output.getPage(0).getWidth(), 842);
  assert.equal(output.getPage(0).getHeight(), 595);
  assert.equal(output.getPage(1).getRotation().angle, 90);
});

for (const fixture of [
  { extension: 'jpg', mimeType: 'image/jpeg', encode: (image: Sharp) => image.jpeg({ quality: 90 }) },
  { extension: 'png', mimeType: 'image/png', encode: (image: Sharp) => image.png() },
  { extension: 'webp', mimeType: 'image/webp', encode: (image: Sharp) => image.webp({ quality: 90 }) },
] as const) {
  test(`${fixture.extension.toUpperCase()} portrait images become A4 portrait print pages`, async () => {
    const image = sharp({
      create: { width: 480, height: 960, channels: 4, background: { r: 255, g: 128, b: 16, alpha: 0.55 } },
    });
    const bytes = await fixture.encode(image).toBuffer();
    const result = await buildPrintableSourcePdf({
      bytes,
      fileName: `SOP.${fixture.extension}`,
      mimeType: fixture.mimeType,
      imagePaperSize: 'A4',
    });
    const output = await PDFDocument.load(result.bytes);
    assert.equal(output.getPageCount(), 1);
    assert.ok(Math.abs(output.getPage(0).getWidth() - 595.28) < 0.1);
    assert.ok(Math.abs(output.getPage(0).getHeight() - 841.89) < 0.1);
  });
}

test('landscape drawing images honor the requested A3 paper size', async () => {
  const bytes = await sharp({
    create: { width: 1600, height: 900, channels: 3, background: { r: 240, g: 240, b: 240 } },
  }).webp({ lossless: true }).toBuffer();
  const result = await buildPrintableSourcePdf({
    bytes,
    fileName: '原图.webp',
    mimeType: 'image/webp',
    imagePaperSize: 'A3',
  });
  const output = await PDFDocument.load(result.bytes);
  assert.ok(Math.abs(output.getPage(0).getWidth() - 1190.55) < 0.1);
  assert.ok(Math.abs(output.getPage(0).getHeight() - 841.89) < 0.1);
});

test('spoofed image content is rejected before decoding', async () => {
  await assert.rejects(
    buildPrintableSourcePdf({
      bytes: new TextEncoder().encode('not a png'),
      fileName: '伪造SOP.png',
      mimeType: 'image/png',
    }),
    (error: unknown) => error instanceof PrintableDocumentError
      && error.code === 'PRINTABLE_SOURCE_SIGNATURE_INVALID',
  );
});

test('object-storage content is bounded by actual streamed bytes instead of metadata alone', async () => {
  await assert.rejects(
    readPrintableSourceStream(Readable.from([Buffer.alloc(6), Buffer.alloc(6)]), {
      fileName: '超限SOP.png',
      maxBytes: 10,
    }),
    (error: unknown) => error instanceof PrintableDocumentError
      && error.code === 'PRINTABLE_SOURCE_TOO_LARGE'
      && error.status === 413,
  );
});
