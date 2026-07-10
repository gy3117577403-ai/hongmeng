import { parseConnectorManual } from '@/lib/connector-manual-parser';
import type { ConnectorManualParserResult } from '@/lib/connector-manual-parser';

export type ClientManualInspection = ConnectorManualParserResult & {
  pageCount: number;
  hash: string;
  parseFailed: boolean;
};

type PromiseWithResolversResult<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: Error | string) => void;
};

type PromiseConstructorWithResolvers = PromiseConstructor & {
  withResolvers?: <T>() => PromiseWithResolversResult<T>;
};

function ensurePromiseWithResolvers(): void {
  const promiseConstructor = Promise as PromiseConstructorWithResolvers;
  if (typeof promiseConstructor.withResolvers === 'function') return;
  promiseConstructor.withResolvers = function withResolvers<T>(): PromiseWithResolversResult<T> {
    let resolveFn: (value: T | PromiseLike<T>) => void = () => {};
    let rejectFn: (reason?: Error | string) => void = () => {};
    const promise = new Promise<T>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });
    return { promise, resolve: resolveFn, reject: rejectFn };
  };
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer)).map(value => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', buffer));
}

async function pageText(page: { getTextContent: () => Promise<{ items: object[] }> }): Promise<string> {
  const content = await page.getTextContent();
  return content.items.map(item => 'str' in item ? String(item.str || '') : '').filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export async function inspectConnectorManualFile(file: File, relativePath = ''): Promise<ClientManualInspection> {
  const buffer = await file.arrayBuffer();
  const hash = await sha256(buffer);
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) {
    return { ...parseConnectorManual({ fileName: file.name, relativePath, fileSize: file.size, mimeType: file.type }), pageCount: 1, hash, parseFailed: false };
  }
  ensurePromiseWithResolvers();
  type PdfDocumentLike = { numPages: number; getPage: (pageNo: number) => Promise<{ getTextContent: () => Promise<{ items: object[] }> }>; getMetadata: () => Promise<{ info?: object }>; destroy: () => Promise<void> };
  let document: PdfDocumentLike | null = null;
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/api/pdf-worker';
    const pdfDocument = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useWorkerFetch: false }).promise as unknown as PdfDocumentLike;
    document = pdfDocument;
    const firstPageText = pdfDocument.numPages >= 1 ? await pageText(await pdfDocument.getPage(1)) : '';
    const secondPageText = pdfDocument.numPages >= 2 ? await pageText(await pdfDocument.getPage(2)) : '';
    const metadata = await pdfDocument.getMetadata().catch(() => ({ info: {} }));
    const metadataInfo = metadata.info && typeof metadata.info === 'object' ? metadata.info as Record<string, unknown> : {};
    return {
      ...parseConnectorManual({
        fileName: file.name,
        relativePath,
        fileSize: file.size,
        mimeType: file.type,
        metadataTitle: String(metadataInfo.Title || ''),
        firstPageText,
        secondPageText,
      }),
      pageCount: pdfDocument.numPages,
      hash,
      parseFailed: false,
    };
  } catch {
    const fallback = parseConnectorManual({ fileName: file.name, relativePath, fileSize: file.size, mimeType: file.type });
    return { ...fallback, warnings: ['自动识别失败，仍可按文件名导入', ...fallback.warnings], pageCount: 0, hash, parseFailed: true };
  } finally {
    if (document) await document.destroy().catch(() => undefined);
  }
}

export async function inspectConnectorManualFiles<T>(
  inputs: T[],
  inspect: (input: T, index: number) => Promise<void>,
  concurrency = 2,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(2, concurrency)) }, async () => {
    while (cursor < inputs.length) {
      const index = cursor;
      cursor += 1;
      await inspect(inputs[index], index);
    }
  });
  await Promise.all(workers);
}
