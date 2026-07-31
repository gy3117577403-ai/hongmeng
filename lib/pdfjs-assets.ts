export const PDFJS_CMAP_URL = '/pdfjs/cmaps/';
export const PDFJS_STANDARD_FONT_DATA_URL = '/pdfjs/standard_fonts/';

/**
 * Shared PDF.js asset configuration.
 *
 * A number of customer drawings use non-embedded Chinese CID fonts (for
 * example SimSun with GBK-EUC-H). PDF.js needs its packaged CMaps and fallback
 * fonts to render those glyphs; without them the original file is intact but
 * the browser preview silently drops parts of the text.
 */
export function createPdfJsAssetOptions() {
  return {
    cMapUrl: PDFJS_CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: PDFJS_STANDARD_FONT_DATA_URL,
    useSystemFonts: true,
  } as const;
}
