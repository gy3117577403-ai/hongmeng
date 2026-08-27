import type { WorkOrderQualityWarningSnapshot } from '@/lib/work-order-qr-service';

export type QualityPrintBlock =
  | { kind: 'text'; title: string; lines: string[]; emphasis: boolean; heightMm: number }
  | { kind: 'photos'; photos: WorkOrderQualityWarningSnapshot['attachments']; imageHeightMm: number; heightMm: number;
      columns?: number; sizes?: Array<{ widthMm: number; heightMm: number }>; captionWidth?: number; group?: string | null };
export type QualityPrintPage = { blocks: QualityPrintBlock[] };

export function qualityPrintHeaderExtraMm(order: { productName: string; specification?: string | null; workOrderCode: string; businessWorkOrderCode?: string | null }) {
  return Math.max(0, Math.max(wrapQualityPrintText(`产品 ${order.specification || order.productName}`, 36).length,
    wrapQualityPrintText(`工单 ${order.businessWorkOrderCode || order.workOrderCode}`, 54).length) - 1) * 5;
}

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
  return warning.printLayoutVersion === 'ASPECT_V1' ? buildAspectPagesV1(warning) : buildLegacyPages(warning);
}

// Issued print snapshots without a version retain the original page manifest and rendering.
function buildLegacyPages(warning: WorkOrderQualityWarningSnapshot): QualityPrintPage[] {
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

/** Frozen contract for newly issued ASPECT_V1 packets. All dimensions are physical millimetres. */
function buildAspectPagesV1(warning: WorkOrderQualityWarningSnapshot): QualityPrintPage[] {
  const budget = Math.max(100, 198 - Math.max(0, wrapQualityPrintText(warning.title, 80).length - 1) * 6 - (warning.printHeaderExtraMm || 0));
  const blocks: QualityPrintBlock[] = [];
  const addText = (title: string, text: string | null | undefined, emphasis = false) => {
    if (!text?.trim()) return;
    const lines = wrapQualityPrintText(text.trim());
    for (let i = 0; i < lines.length; i += 22) {
      const part = lines.slice(i, i + 22);
      blocks.push({ kind: 'text', title: i ? `${title}（续）` : title, lines: part, emphasis, heightMm: 9 + part.length * 5.5 });
    }
  };
  addText('具体问题', warning.defectPhenomenon || warning.warningSummary, true);
  addText('确认原因', warning.rootCause);
  addText('解决方案', warning.correctiveAction || warning.controlRequirement, true);
  addText('处理结论', warning.finalConclusion);
  const photos = warning.attachments.filter(photo => photo.mimeType.startsWith('image/') && photo.printIncluded !== false);
  if (photos.some(photo => !(Number(photo.imageWidth) > 0 && Number(photo.imageHeight) > 0))) {
    throw new Error('图片尺寸尚未解析，不能生成可能拉伸的打印页');
  }
  const done = new Set<string>();
  const detail = warning.printPhotoLayout === 'SINGLE';
  for (const first of photos) {
    if (done.has(first.id)) continue;
    const remaining = photos.filter(photo => !done.has(photo.id));
    const group = first.printGroup || null;
    const grouped = group ? remaining.filter(photo => photo.printGroup === group) : [];
    if (grouped.length > 2) throw new Error('同一图片对照组最多两张，请拆分组别');
    const candidates = remaining.slice(0, 3);
    const threePortraits = !detail && candidates.length === 3 && candidates.every(photo => !photo.printGroup && Number(photo.imageWidth) / Number(photo.imageHeight) < 0.85);
    // A trailing third landscape stays half-width instead of unexpectedly becoming a full-width sheet.
    const columns = group ? 2 : detail || photos.length === 1 ? 1 : threePortraits ? 3 : 2;
    const row = group ? grouped : remaining.slice(0, columns).filter((photo, i, all) => !photo.printGroup && !all.slice(0, i).some(previous => previous.printGroup));
    const cap = detail && !group ? 135 : columns === 3 ? 95 : columns === 1 ? 110 : 90;
    // 192 mm content width; 3 mm gutters; figure borders+padding consume 3.1 mm.
    const imageWidth = (192 - (columns - 1) * 3) / columns - 3.1;
    const sizes = row.map(photo => {
      const ratio = Number(photo.imageWidth) / Number(photo.imageHeight);
      const heightMm = Math.min(cap, imageWidth / ratio);
      return { widthMm: heightMm * ratio, heightMm };
    });
    const imageHeightMm = Math.max(...sizes.map(size => size.heightMm));
    const captionWidth = columns === 1 ? 84 : columns === 3 ? 25 : 39;
    const labelled = row.map(photo => {
      const caption = photo.caption || photo.displayName;
      const text = `图 ${photos.indexOf(photo) + 1} · ${caption}`;
      return { ...photo, caption: wrapQualityPrintText(text, captionWidth).length > 3 ? `图 ${photos.indexOf(photo) + 1} · 完整说明见后文` : text };
    });
    const captionLines = Math.max(...labelled.map(photo => wrapQualityPrintText(photo.caption!, captionWidth).length));
    const overhead = 6 + captionLines * 5 + (group ? 6 : 0);
    const fraction = Math.min(1, (budget - overhead - 3) / imageHeightMm);
    blocks.push({ kind: 'photos', photos: labelled, columns, sizes: sizes.map(size => ({ widthMm: size.widthMm * fraction, heightMm: size.heightMm * fraction })), captionWidth, group, imageHeightMm: imageHeightMm * fraction,
      heightMm: imageHeightMm * fraction + overhead });
    row.forEach(photo => {
      done.add(photo.id);
      if (wrapQualityPrintText(`图 ${photos.indexOf(photo) + 1} · ${photo.caption || photo.displayName}`, captionWidth).length > 3) {
        addText(`图 ${photos.indexOf(photo) + 1} 完整说明`, photo.caption || photo.displayName);
      }
    });
  }
  addText('本批作业要求', warning.requiredAction, true);
  addText('检查方法', warning.inspectionMethod);
  addText('检查频次', warning.inspectionFrequency);
  addText('合格判定', warning.acceptanceCriteria, true);
  addText('停止作业 / 升级条件', warning.stopConditions, true);

  const pages: QualityPrintPage[] = [];
  let page: QualityPrintPage = { blocks: [] }; let used = 0;
  const pushPage = () => {
    if (!detail) {
      // If a tail row was fitted to remaining space, keep same-ratio photos on this page equally sized.
      const widths = new Map<string, number>();
      const key = (block: Extract<QualityPrintBlock, { kind: 'photos' }>, photo: WorkOrderQualityWarningSnapshot['attachments'][number]) => `${block.columns}:${(Number(photo.imageWidth) / Number(photo.imageHeight)).toFixed(6)}`;
      for (const block of page.blocks) if (block.kind === 'photos' && block.sizes) block.photos.forEach((photo, i) => {
        const k = key(block, photo); widths.set(k, Math.min(widths.get(k) || Infinity, block.sizes![i].widthMm));
      });
      page.blocks = page.blocks.map(block => {
        if (block.kind !== 'photos' || !block.sizes) return block;
        const sizes = block.photos.map((photo, i) => {
          const widthMm = widths.get(key(block, photo))!;
          return { widthMm, heightMm: widthMm / (Number(photo.imageWidth) / Number(photo.imageHeight)) };
        });
        const imageHeightMm = Math.max(...sizes.map(size => size.heightMm));
        return { ...block, sizes, imageHeightMm, heightMm: block.heightMm - block.imageHeightMm + imageHeightMm };
      });
    }
    if (page.blocks.length) pages.push(page); page = { blocks: [] }; used = 0;
  };
  for (const source of blocks) {
    let block = source;
    const room = budget - used - 3;
    if (block.kind === 'photos' && block.heightMm > room && block.sizes) {
      const fraction = (room - (block.heightMm - block.imageHeightMm)) / block.imageHeightMm;
      // Only a modest proportional adjustment is allowed; never squeeze detail to force one page.
      if (!detail && fraction >= 0.88 && fraction < 1) {
        block = { ...block, heightMm: room, imageHeightMm: block.imageHeightMm * fraction,
          sizes: block.sizes.map(size => ({ widthMm: size.widthMm * fraction, heightMm: size.heightMm * fraction })) };
      }
    }
    if (block.kind === 'text' && block.heightMm > room && room >= 31 && block.lines.length > 4) {
      const count = Math.min(block.lines.length - 2, Math.floor((room - 9) / 5.5));
      page.blocks.push({ ...block, lines: block.lines.slice(0, count), heightMm: 9 + count * 5.5 });
      pushPage();
      block = { ...block, title: `${block.title.replace(/（续）$/, '')}（续）`, lines: block.lines.slice(count), heightMm: 9 + (block.lines.length - count) * 5.5 };
    }
    if (used + block.heightMm + 3 > budget && page.blocks.length) pushPage();
    page.blocks.push(block); used += block.heightMm + 3;
  }
  pushPage();
  return pages.length ? pages : [{ blocks: [] }];
}
