import type { WorkOrderQualityWarningSnapshot } from '@/lib/work-order-qr-service';

export type QualityPrintBlock =
  | { kind: 'text'; title: string; lines: string[]; emphasis: boolean; heightMm: number }
  | { kind: 'photos'; photos: WorkOrderQualityWarningSnapshot['attachments']; imageHeightMm: number; heightMm: number };
export type QualityPrintPage = { blocks: QualityPrintBlock[] };

/** Conservative CJK/Latin wrapping shared by preview, packet validation and capture. No content truncation. */
export function wrapQualityPrintText(input: string, width = 94) {
  const lines: string[] = [];
  for (const paragraph of input.replace(/\r/g, '').split('\n')) {
    let line = ''; let units = 0;
    for (const char of Array.from(paragraph)) {
      const size = /[MW@#%]/.test(char) ? 2 : /[\u0000-\u007f]/.test(char) ? 1.15 : 2;
      if (units + size > width && line) { lines.push(line); line = ''; units = 0; }
      line += char; units += size;
    }
    lines.push(line);
  }
  return lines;
}

export function buildQualityWarningPages(warning: WorkOrderQualityWarningSnapshot): QualityPrintPage[] {
  const blocks: QualityPrintBlock[] = [];
  const sections: Array<[string, string | null | undefined, boolean]> = [
    ['具体问题', warning.defectPhenomenon || warning.warningSummary, true],
    ['确认原因', warning.rootCause, false],
    ['解决方案', warning.correctiveAction || warning.controlRequirement, true],
    ['处理结论', warning.finalConclusion, false],
    ['本批作业要求', warning.requiredAction, true],
    ['检查方法', warning.inspectionMethod, false], ['检查频次', warning.inspectionFrequency, false],
    ['合格判定', warning.acceptanceCriteria, true], ['停止作业 / 升级条件', warning.stopConditions, true],
  ];
  for (const [title, text, emphasis] of sections) {
    if (!text?.trim()) continue;
    const lines = wrapQualityPrintText(text.trim());
    for (let start = 0; start < lines.length; start += 22) {
      const part = lines.slice(start, start + 22);
      blocks.push({ kind: 'text', title: start ? `${title}（续）` : title, lines: part, emphasis, heightMm: 9 + part.length * 5.5 });
    }
  }
  const photos = warning.attachments.filter(item => item.mimeType.startsWith('image/') && item.printIncluded !== false);
  const columns = warning.printPhotoLayout === 'SINGLE' || photos.length === 1 ? 1 : 2;
  for (let start = 0; start < photos.length; start += columns) {
    const row = photos.slice(start, start + columns);
    const imageHeightMm = columns === 1 ? 135 : 70;
    const captionLines = Math.max(...row.map(photo => wrapQualityPrintText(photo.caption || photo.displayName, columns === 1 ? 84 : 39).length));
    // Long captions get their own text block rather than shrinking evidence images.
    const shortRow = row.map(photo => ({ ...photo, caption: wrapQualityPrintText(photo.caption || photo.displayName, columns === 1 ? 84 : 39).length > 3 ? `图 ${photos.indexOf(photo) + 1} · 完整说明见后文` : photo.caption || photo.displayName }));
    blocks.push({ kind: 'photos', photos: shortRow, imageHeightMm, heightMm: imageHeightMm + 8 + Math.min(captionLines, 3) * 5 });
    row.forEach(photo => {
      const caption = photo.caption || photo.displayName;
      if (wrapQualityPrintText(caption, columns === 1 ? 84 : 39).length <= 3) return;
      const lines = wrapQualityPrintText(caption);
      for (let i = 0; i < lines.length; i += 22) { const part = lines.slice(i, i + 22); blocks.push({ kind: 'text', title: `图 ${photos.indexOf(photo) + 1} 说明`, lines: part, emphasis: false, heightMm: 9 + part.length * 5.5 }); }
    });
  }
  const pages: QualityPrintPage[] = [];
  let page: QualityPrintPage = { blocks: [] }; let used = 0;
  const budget = Math.max(150, 210 - Math.max(0, wrapQualityPrintText(warning.title, 80).length - 1) * 6);
  for (const block of blocks) {
    if (block.kind === 'photos' && used + block.heightMm + 3 > budget) {
      const availableImageHeight = budget - used - 3 - (block.heightMm - block.imageHeightMm);
      const minimum = block.photos.length === 1 ? 95 : 60;
      if (availableImageHeight >= minimum) { block.heightMm -= block.imageHeightMm - availableImageHeight; block.imageHeightMm = availableImageHeight; }
    }
    if (used + block.heightMm + 3 > budget && page.blocks.length) { pages.push(page); page = { blocks: [] }; used = 0; }
    page.blocks.push(block); used += block.heightMm + 3;
  }
  if (page.blocks.length || !pages.length) pages.push(page);
  return pages;
}

export function flattenQualityWarningPages(warnings: WorkOrderQualityWarningSnapshot[]) {
  return warnings.flatMap(warning => buildQualityWarningPages(warning).map(page => ({ warning, page })));
}
