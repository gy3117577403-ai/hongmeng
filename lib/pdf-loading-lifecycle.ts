type PdfLoadingTask = { promise: Promise<unknown>; destroy(): Promise<void> };

const releases = new WeakMap<PdfLoadingTask, Promise<void>>();

/** PDFDocumentProxy.destroy delegates to this same task. Release its owner once,
 * after initialization settles: PDF.js' fallback worker otherwise rejects a late
 * network callback outside the loading promise while processing Terminate. */
export function releasePdfLoadingTask(task: PdfLoadingTask): Promise<void> {
  const existing = releases.get(task);
  if (existing) return existing;
  const release = task.promise.catch(() => undefined).then(() => task.destroy());
  releases.set(task, release);
  return release;
}
