import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pdfjsRoot = join(repositoryRoot, 'node_modules', 'pdfjs-dist');
const publicRoot = join(repositoryRoot, 'public', 'pdfjs');

const assets = [
  ['cmaps', 'cmaps'],
  ['standard_fonts', 'standard_fonts'],
];

mkdirSync(publicRoot, { recursive: true });

for (const [sourceName, targetName] of assets) {
  const source = join(pdfjsRoot, sourceName);
  const target = join(publicRoot, targetName);
  if (!existsSync(source)) {
    throw new Error(`Missing PDF.js asset directory: ${source}`);
  }
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });
}

console.log(`Prepared PDF.js CMaps and fallback fonts in ${publicRoot}`);
