import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { releasePdfLoadingTask } from '../lib/pdf-loading-lifecycle';

test('closing an initializing PDF waits for its load result and releases its owner once', async () => {
  let finish!: () => void;
  let destroyed = 0;
  const task = { promise: new Promise<void>(resolve => { finish = resolve; }), async destroy() { destroyed++; } };
  const first = releasePdfLoadingTask(task);
  const second = releasePdfLoadingTask(task);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(destroyed, 0);
  finish();
  await first;
  await releasePdfLoadingTask(task);
  assert.equal(destroyed, 1);
});

test('a failed load still releases resources and an actual cleanup error reaches the caller', async () => {
  const failure = new Error('Worker cleanup unavailable');
  const task = { promise: Promise.reject(new Error('Source removed')), async destroy() { throw failure; } };
  await assert.rejects(releasePdfLoadingTask(task), error => error === failure);
});

for (const status of [200, 404]) {
  test(`real PDF.js pending network ${status} can close without a terminated-worker rejection`, async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([100, 100]);
    const bytes = Buffer.from(await pdf.save());
    let respond!: () => void;
    let requested!: () => void;
    const responseGate = new Promise<void>(resolve => { respond = resolve; });
    const requestSeen = new Promise<void>(resolve => { requested = resolve; });
    const server = createServer(async (_request, response) => {
      requested();
      await responseGate;
      response.writeHead(status, { 'Content-Type': status === 200 ? 'application/pdf' : 'text/plain' });
      response.end(status === 200 ? bytes : 'Source removed while switching file');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const task = pdfjs.getDocument({ url: `http://127.0.0.1:${address.port}/drawing.pdf`, isEvalSupported: false });
      await requestSeen;
      const release = releasePdfLoadingTask(task);
      respond();
      await release;
      assert.equal(task.destroyed, true);
      // Let the fallback worker's delayed callbacks execute; node:test also
      // fails this test on uncaught exceptions or unhandled rejections.
      await new Promise(resolve => setImmediate(resolve));
    } finally {
      respond();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
}
