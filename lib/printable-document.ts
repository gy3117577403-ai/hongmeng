import { PDFDocument, degrees } from 'pdf-lib';
import { normalizePreviewRotation } from '@/lib/preview-gestures';
import type { PageRotations } from '@/lib/document-orientation';
import sharp from 'sharp';
import { fileType, validateFileSignature } from '@/lib/validation';

export type PrintableSourceFormat = 'pdf' | 'jpg' | 'png' | 'webp';
export type ImagePrintPaperSize = 'A4' | 'A3';

export type PrintableSourceInput = {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string | null;
  imagePaperSize?: ImagePrintPaperSize;
  pageRotations?: PageRotations;
};

export class PrintableDocumentError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 409, code = 'PRINTABLE_SOURCE_INVALID') {
    super(message);
    this.name = 'PrintableDocumentError';
    this.status = status;
    this.code = code;
  }
}

const PAPER_POINTS: Record<ImagePrintPaperSize, readonly [number, number]> = {
  A4: [595.28, 841.89],
  A3: [841.89, 1190.55],
};
const PRINT_MARGIN_POINTS = 24;
const PRINT_DPI = 300;
const MAX_IMAGE_INPUT_PIXELS = 60_000_000;
const MAX_IMAGE_PAGES = 20;

export function printableSourceFormat(fileName: string, mimeType?: string | null): PrintableSourceFormat | null {
  const detected = fileType(fileName, mimeType || '');
  return detected === 'unknown' ? null : detected;
}

export function isPrintableImageFormat(format: PrintableSourceFormat): format is Exclude<PrintableSourceFormat, 'pdf'> {
  return format !== 'pdf';
}

export function normalizedPrintFilename(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/u, '').trim() || 'production-document';
  return `${stem}.pdf`;
}

export async function readPrintableSourceStream(
  stream: NodeJS.ReadableStream,
  input: { fileName: string; maxBytes: number },
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > input.maxBytes) {
      throw new PrintableDocumentError(
        `${input.fileName} 实际内容超过 ${Math.floor(input.maxBytes / (1024 * 1024))}MB，无法转换打印`,
        413,
        'PRINTABLE_SOURCE_TOO_LARGE',
      );
    }
    chunks.push(buffer);
  }
  if (!totalBytes) {
    throw new PrintableDocumentError(`${input.fileName} 文件为空，无法打印`, 409, 'PRINTABLE_SOURCE_EMPTY');
  }
  return Buffer.concat(chunks, totalBytes);
}

function invalidSignature(input: PrintableSourceInput, format: PrintableSourceFormat) {
  const signatureError = validateFileSignature(format, input.bytes);
  if (signatureError) {
    throw new PrintableDocumentError(
      `${input.fileName} 的文件内容与格式不一致或已经损坏，无法打印`,
      409,
      'PRINTABLE_SOURCE_SIGNATURE_INVALID',
    );
  }
}

async function appendPdf(output: PDFDocument, input: PrintableSourceInput): Promise<number> {
  invalidSignature(input, 'pdf');
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(input.bytes, { ignoreEncryption: false, updateMetadata: false });
  } catch {
    throw new PrintableDocumentError(
      `${input.fileName} 已加密或损坏，无法合并打印`,
      409,
      'PRINTABLE_SOURCE_PDF_INVALID',
    );
  }
  if (!source.getPageCount()) {
    throw new PrintableDocumentError(`${input.fileName} 没有可打印页面`, 409, 'PRINTABLE_SOURCE_PDF_EMPTY');
  }
  const pages = await output.copyPages(source, source.getPageIndices());
  pages.forEach((page, index) => {
    page.setRotation(degrees(normalizePreviewRotation(page.getRotation().angle + (input.pageRotations?.[index + 1] || 0))));
    output.addPage(page);
  });
  return pages.length;
}

function orientationSwapsDimensions(orientation: number | undefined): boolean {
  return orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8;
}

function imagePageDimensions(input: {
  width: number;
  height: number;
  orientation?: number;
  paperSize: ImagePrintPaperSize;
}) {
  const orientedWidth = orientationSwapsDimensions(input.orientation) ? input.height : input.width;
  const orientedHeight = orientationSwapsDimensions(input.orientation) ? input.width : input.height;
  const [paperShort, paperLong] = PAPER_POINTS[input.paperSize];
  const landscape = orientedWidth > orientedHeight;
  const pageWidth = landscape ? paperLong : paperShort;
  const pageHeight = landscape ? paperShort : paperLong;
  const contentWidth = pageWidth - (PRINT_MARGIN_POINTS * 2);
  const contentHeight = pageHeight - (PRINT_MARGIN_POINTS * 2);
  return {
    pageWidth,
    pageHeight,
    contentWidth,
    contentHeight,
    targetPixelWidth: Math.max(1, Math.floor((contentWidth / 72) * PRINT_DPI)),
    targetPixelHeight: Math.max(1, Math.floor((contentHeight / 72) * PRINT_DPI)),
  };
}

async function appendImage(
  output: PDFDocument,
  input: PrintableSourceInput,
  format: Exclude<PrintableSourceFormat, 'pdf'>,
): Promise<number> {
  invalidSignature(input, format);
  let metadata;
  try {
    metadata = await sharp(input.bytes, {
      animated: true,
      failOn: 'error',
      limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
      sequentialRead: true,
    }).metadata();
  } catch {
    throw new PrintableDocumentError(
      `${input.fileName} 图片损坏或像素过大，无法打印`,
      409,
      'PRINTABLE_SOURCE_IMAGE_INVALID',
    );
  }
  const width = Number(metadata.width || 0);
  const height = Number(metadata.pageHeight || metadata.height || 0);
  const pageCount = Math.max(1, Number(metadata.pages || 1));
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new PrintableDocumentError(`${input.fileName} 缺少有效图片尺寸`, 409, 'PRINTABLE_SOURCE_IMAGE_DIMENSIONS_INVALID');
  }
  if (pageCount > MAX_IMAGE_PAGES) {
    throw new PrintableDocumentError(
      `${input.fileName} 包含 ${pageCount} 个画面，超过最多 ${MAX_IMAGE_PAGES} 页的打印限制`,
      413,
      'PRINTABLE_SOURCE_IMAGE_PAGE_LIMIT',
    );
  }

  const paperSize = input.imagePaperSize === 'A3' ? 'A3' : 'A4';
  const dimensions = imagePageDimensions({ width, height, orientation: metadata.orientation, paperSize });
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    let normalized;
    try {
      normalized = await sharp(input.bytes, {
        page: pageIndex,
        pages: 1,
        failOn: 'error',
        limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
        sequentialRead: true,
      })
        .rotate()
        .flatten({ background: '#ffffff' })
        .resize({
          width: dimensions.targetPixelWidth,
          height: dimensions.targetPixelHeight,
          fit: 'inside',
          withoutEnlargement: true,
          kernel: 'lanczos3',
        })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new PrintableDocumentError(
        `${input.fileName} 第 ${pageIndex + 1} 个画面无法转换为打印页面`,
        409,
        'PRINTABLE_SOURCE_IMAGE_CONVERSION_FAILED',
      );
    }
    const embedded = await output.embedPng(normalized.data);
    const scale = Math.min(
      dimensions.contentWidth / embedded.width,
      dimensions.contentHeight / embedded.height,
      1,
    );
    const drawWidth = embedded.width * scale;
    const drawHeight = embedded.height * scale;
    const page = output.addPage([dimensions.pageWidth, dimensions.pageHeight]);
    page.setRotation(degrees(normalizePreviewRotation(input.pageRotations?.[1] || 0)));
    page.drawImage(embedded, {
      x: (dimensions.pageWidth - drawWidth) / 2,
      y: (dimensions.pageHeight - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    });
  }
  return pageCount;
}

export async function appendPrintableSource(output: PDFDocument, input: PrintableSourceInput): Promise<number> {
  const format = printableSourceFormat(input.fileName, input.mimeType);
  if (!format) {
    throw new PrintableDocumentError(
      `${input.fileName} 的格式不支持打印；仅支持 PDF、JPG、JPEG、PNG、WebP`,
      409,
      'PRINTABLE_SOURCE_FORMAT_UNSUPPORTED',
    );
  }
  return format === 'pdf' ? appendPdf(output, input) : appendImage(output, input, format);
}

export async function buildPrintableSourcePdf(input: PrintableSourceInput & { title?: string }) {
  const output = await PDFDocument.create();
  output.setTitle(input.title || normalizedPrintFilename(input.fileName));
  output.setCreator('杭连电子协同平台');
  output.setProducer('杭连电子协同平台');
  const pageCount = await appendPrintableSource(output, input);
  const bytes = await output.save({ useObjectStreams: false, addDefaultPage: false, objectsPerTick: 50 });
  return { bytes, pageCount };
}
