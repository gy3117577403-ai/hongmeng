import { existsSync } from 'node:fs';
import path from 'node:path';

const REQUIRED_CMAP = 'GBK-EUC-H.bcmap';
const REQUIRED_STANDARD_FONT = 'LiberationSans-Regular.ttf';

function assetRootCandidates() {
  return [
    path.resolve(process.cwd(), 'public', 'pdfjs'),
    path.resolve(process.cwd(), '.next', 'standalone', 'public', 'pdfjs'),
    path.resolve(process.cwd(), 'node_modules', 'pdfjs-dist'),
    path.resolve(process.cwd(), '..', '..', 'node_modules', 'pdfjs-dist'),
  ];
}

function resolveAssetDirectory(directory: 'cmaps' | 'standard_fonts', requiredFile: string) {
  const resolved = assetRootCandidates()
    .map(root => path.join(root, directory))
    .find(candidate => existsSync(path.join(candidate, requiredFile)));

  if (!resolved) {
    throw new Error(`PDF.js ${directory} assets are missing; run npm run pdfjs:assets before starting the application`);
  }

  return resolved.endsWith(path.sep) ? resolved : `${resolved}${path.sep}`;
}

/**
 * Node-side equivalent of the browser PDF.js asset options.
 *
 * The public directory is preferred because it is copied into the standalone
 * Docker image. The package directory remains a development/test fallback.
 */
export function createPdfJsServerAssetOptions() {
  return {
    cMapUrl: resolveAssetDirectory('cmaps', REQUIRED_CMAP),
    cMapPacked: true,
    standardFontDataUrl: resolveAssetDirectory('standard_fonts', REQUIRED_STANDARD_FONT),
    useSystemFonts: true,
  } as const;
}
