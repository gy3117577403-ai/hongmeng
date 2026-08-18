import { existsSync } from 'node:fs';
import path from 'node:path';

export type PdfJsWorkerFile = 'pdf.worker.mjs' | 'pdf.worker.min.mjs';

export function pdfJsWorkerCandidates(
  fileName: PdfJsWorkerFile,
  cwd = process.cwd(),
): string[] {
  const relativeWorker = path.join('node_modules', 'pdfjs-dist', 'legacy', 'build', fileName);
  const roots = [
    cwd,
    path.resolve(cwd, '.next', 'standalone'),
    path.resolve(cwd, '..', '..'),
    path.resolve(cwd, '..', '..', '..'),
  ];
  return Array.from(new Set(roots.map(root => path.resolve(root, relativeWorker))));
}

export function resolvePdfJsWorkerPath(
  fileName: PdfJsWorkerFile,
  cwd = process.cwd(),
): string | null {
  return pdfJsWorkerCandidates(fileName, cwd).find(candidate => existsSync(candidate)) || null;
}
