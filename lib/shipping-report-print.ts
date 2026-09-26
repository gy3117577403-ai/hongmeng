import { createPdfJsAssetOptions } from './pdfjs-assets';

/** Print the archived paper at 300 dpi without invoking the browser's PDF plug-in. */
export async function printShippingReportPdf(bytes: ArrayBuffer, title: string, reportId?: string) {
  const ctor = Promise as PromiseConstructor & { withResolvers?: <T>() => { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (reason?: unknown) => void } };
  if (!ctor.withResolvers) ctor.withResolvers = function<T>() { let resolve!: (value: T | PromiseLike<T>) => void, reject!: (reason?: unknown) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/api/pdf-worker';
  const task = pdfjs.getDocument({ data: bytes.slice(0), ...createPdfJsAssetOptions(), useWorkerFetch: false, isEvalSupported: false });
  let frame: HTMLIFrameElement | undefined, imageUrl: string | undefined;
  const canvas = document.createElement('canvas');
  const cleanup = () => { frame?.remove(); if (imageUrl) URL.revokeObjectURL(imageUrl); };
  try {
    const pdf = await task.promise;
    if (pdf.numPages !== 1) throw Error('报告页数不正确，请下载 PDF 核对。');
    const page = await pdf.getPage(1), viewport = page.getViewport({ scale: 300 / 72 });
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) throw Error('浏览器无法准备打印，请下载 PDF 后打印。');
    await page.render({ canvasContext: context, viewport, background: '#ffffff' }).promise;
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(Error('打印纸面生成失败，请重试。')), 'image/png'));
    imageUrl = URL.createObjectURL(blob);
    frame = document.createElement('iframe'); frame.className = 'sr-print-frame'; frame.title = '出货报告打印';
    if (reportId) frame.dataset.reportId = reportId;
    document.body.appendChild(frame);
    const doc = frame.contentDocument, target = frame.contentWindow;
    if (!doc || !target) throw Error('浏览器无法打开打印，请下载 PDF 后打印。');
    doc.title = title;
    const style = doc.createElement('style');
    style.textContent = '@page{size:A4 portrait;margin:0}html,body{margin:0;padding:0;width:210mm;height:297mm;background:white}img{display:block;width:210mm;height:297mm;break-inside:avoid;print-color-adjust:exact;-webkit-print-color-adjust:exact}';
    doc.head.appendChild(style);
    const image = doc.createElement('img'); image.alt = title; image.src = imageUrl; doc.body.appendChild(image);
    await image.decode();
    frame.dataset.ready = 'true';
    // Leave the print document alive while a native print dialog is open.
    target.addEventListener('afterprint', () => setTimeout(cleanup, 1000), { once: true });
    setTimeout(cleanup, 120000);
    target.focus(); target.print();
  } catch (error) { cleanup(); throw error; }
  finally { canvas.width = 0; canvas.height = 0; await task.destroy(); }
}
