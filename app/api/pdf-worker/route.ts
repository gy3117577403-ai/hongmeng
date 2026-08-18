import { readFile } from 'node:fs/promises';
import { resolvePdfJsWorkerPath } from '@/lib/pdfjs-worker.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const workerPath = resolvePdfJsWorkerPath('pdf.worker.min.mjs')
    || resolvePdfJsWorkerPath('pdf.worker.mjs');

  if (!workerPath) {
    return new Response('/* PDF worker unavailable */', {
      status: 500,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  const worker = await readFile(workerPath);
  return new Response(worker, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
