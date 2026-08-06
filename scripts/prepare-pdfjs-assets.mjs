import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'node:fs';
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

function copyDirectory(source, target) {
  mkdirSync(target, { recursive: true });

  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
      continue;
    }

    if (entry.isFile()) {
      copyFileSync(sourcePath, targetPath);
    }
  }
}

for (const [sourceName, targetName] of assets) {
  const source = join(pdfjsRoot, sourceName);
  const target = join(publicRoot, targetName);
  if (!existsSync(source)) {
    throw new Error(`Missing PDF.js asset directory: ${source}`);
  }
  rmSync(target, { recursive: true, force: true });
  // Node's recursive cpSync can terminate the Windows runtime while copying
  // the PDF.js asset tree. Copying file-by-file is deterministic on every
  // supported build platform and keeps the prebuild step observable.
  copyDirectory(source, target);
}

console.log(`Prepared PDF.js CMaps and fallback fonts in ${publicRoot}`);
