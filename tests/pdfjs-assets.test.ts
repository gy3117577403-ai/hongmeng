import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  PDFJS_CMAP_URL,
  PDFJS_STANDARD_FONT_DATA_URL,
  createPdfJsAssetOptions,
} from '../lib/pdfjs-assets';
import { createPdfJsServerAssetOptions } from '../lib/pdfjs-assets.server';

function createLegacyChinesePdf() {
  const stream = 'BT /F1 24 Tf 50 200 Td <D6D0CEC4> Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /SimSun /Encoding /GBK-EUC-H /DescendantFonts [5 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /SimSun /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> /FontDescriptor 6 0 R /DW 1000 >>',
    '<< /Type /FontDescriptor /FontName /SimSun /Flags 4 /FontBBox [-10 -260 1000 900] /ItalicAngle 0 /Ascent 859 /Descent -141 /CapHeight 859 /StemV 80 >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];

  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, 'binary'));
}

async function extractPdfText(data: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({
    data,
    ...createPdfJsServerAssetOptions(),
    isEvalSupported: false,
    useWorkerFetch: false,
  }).promise;
  try {
    const content = await (await document.getPage(1)).getTextContent();
    return content.items.map(item => ('str' in item ? item.str : '')).join('');
  } finally {
    await document.destroy();
  }
}

test('PDF.js preview loads packaged CMaps and fallback fonts', () => {
  assert.deepEqual(createPdfJsAssetOptions(), {
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    useSystemFonts: true,
  });
  assert.equal(PDFJS_CMAP_URL, '/pdfjs/cmaps/');
  assert.equal(PDFJS_STANDARD_FONT_DATA_URL, '/pdfjs/standard_fonts/');
});

test('PDF.js server assets resolve to non-empty packed CMaps and fallback fonts', () => {
  const options = createPdfJsServerAssetOptions();
  assert.equal(options.cMapPacked, true);
  assert.equal(options.useSystemFonts, true);
  assert.ok(options.cMapUrl.endsWith(path.sep));
  assert.ok(options.standardFontDataUrl.endsWith(path.sep));

  const cMap = path.join(options.cMapUrl, 'GBK-EUC-H.bcmap');
  const font = path.join(options.standardFontDataUrl, 'LiberationSans-Regular.ttf');
  assert.equal(existsSync(cMap), true);
  assert.equal(existsSync(font), true);
  assert.ok(statSync(cMap).size > 0);
  assert.ok(statSync(font).size > 0);
});

test('PDF.js recovers Chinese text from a GBK-EUC-H drawing without an embedded font', async () => {
  assert.equal(await extractPdfText(createLegacyChinesePdf()), '中文');
});

const localDrawingSample = path.resolve('tmp', 'pdfs', 'gh137-0035a.pdf');
test('current local legacy-Chinese drawing sample keeps its Chinese text', {
  skip: !existsSync(localDrawingSample),
}, async () => {
  const text = await extractPdfText(new Uint8Array(readFileSync(localDrawingSample)));
  assert.match(text, /平行线（红、黑）/);
  assert.match(text, /裁线长度/);
});
