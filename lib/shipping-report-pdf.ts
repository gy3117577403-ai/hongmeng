import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { create as createFont } from 'fontkit';
import { PDFDocument, PDFFont, PDFPage, degrees, rgb } from 'pdf-lib';
import sharp from 'sharp';
import { FinishedGoodsError } from './finished-goods-domain';
import { SHIPPING_REPORT_TEMPLATES, type ShippingReportSnapshot } from './shipping-report-domain';

const MM = 72 / 25.4, W = 210 * MM, H = 297 * MM;
let fontBytes: Promise<Buffer> | undefined;
function fontData() { return fontBytes ||= fs.readFile(path.join(process.cwd(), 'public/fonts/NotoSansSC-Regular.otf')); }
type Drawing = { body: Uint8Array; mimeType: string };

// pdf-lib expects the older streaming encoder; fontkit 2 fixes CJK subset glyph loss.
const pdfFontkit: Parameters<PDFDocument['registerFontkit']>[0] = {
  create(bytes) {
    const font = createFont(Buffer.from(bytes));
    if (!('createSubset' in font)) throw new Error('Expected a single report font');
    const subset = font.createSubset.bind(font);
    font.createSubset = () => {
      const result = subset();
      return Object.assign(result, { encodeStream: () => Readable.from([result.encode()]) });
    };
    return font as unknown as ReturnType<Parameters<PDFDocument['registerFontkit']>[0]['create']>;
  },
};

class Paper {
  constructor(readonly page: PDFPage, readonly font: PDFFont) {}
  line(x: number, y: number, x2: number, y2: number) {
    this.page.drawLine({ start: { x: x * MM, y: H - y * MM }, end: { x: x2 * MM, y: H - y2 * MM }, thickness: 0.65, color: rgb(0, 0, 0) });
  }
  box(x: number, y: number, w: number, h: number) {
    this.page.drawRectangle({ x: x * MM, y: H - (y + h) * MM, width: w * MM, height: h * MM, borderWidth: 0.65, borderColor: rgb(0, 0, 0) });
  }
  text(value: string, x: number, y: number, w: number, h: number, size = 9, center = false) {
    const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ');
    if (!clean) return;
    const wrap = (s: number) => {
      const lines: string[] = []; let current = '';
      for (const char of clean) {
        if (current && this.font.widthOfTextAtSize(current + char, s) > (w - 3) * MM) { lines.push(current); current = char; }
        else current += char;
      }
      if (current) lines.push(current);
      return lines;
    };
    let lines = wrap(size);
    while (lines.length * size * 1.3 > (h - 1) * MM && size > 5) { size -= 0.25; lines = wrap(size); }
    if (lines.length * size * 1.3 > (h - 1) * MM) throw new FinishedGoodsError('字段过长，无法完整放入报告，请缩短本次填写的订单号或批号。', 'REPORT_TEXT_OVERFLOW');
    const top = H - y * MM - ((h * MM - lines.length * size * 1.3) / 2) - size;
    lines.forEach((line, i) => this.page.drawText(line, { font: this.font, size, x: x * MM + (center ? (w * MM - this.font.widthOfTextAtSize(line, size)) / 2 : 1.5 * MM), y: top - i * size * 1.3, color: rgb(0, 0, 0) }));
  }
  cell(value: string, x: number, y: number, w: number, h: number, size = 9, center = false) { this.box(x, y, w, h); this.text(value, x, y, w, h, size, center); }
}

function standardReport(p: Paper, s: ShippingReportSnapshot) {
  const yiwei = s.template === 'yiwei';
  p.text('出 荷 检 查 报 告', 10, 10, 190, 14, 21, true);
  p.cell(`品番：${s.specification}`, 10, 27, 75, 12, 9);
  p.cell(`客户：${s.customerName}`, 85, 27, 65, 12, 9);
  p.cell(`订单号：${s.orderNo}`, 150, 27, 50, 12, 8.5);
  p.cell(`社内 LOT No.：${yiwei ? '' : 'HZHLDZ'}${s.lotNo}`, 10, 39, 78, 10, 8.5);
  p.cell(`数量：${s.quantity} ${s.unit}`, 88, 39, 40, 10);
  p.cell(`日期：${s.reportDate.replace(/-/g, '/')}`, 128, 39, 45, 10, 8.5);
  p.cell('页数：1 / 1', 173, 39, 27, 10, 8.5);
  p.box(10, 49, 190, 83); p.text('略图面：', 11, 49, 30, 7);
  p.text('说明：本略图面制定遵照客户品番。', 115, 126, 84, 5, 7.5);
  const xs = [10, 24, 44, 64, 108, 120, 132, 144, 156, 168, 184, 200];
  const y = 132, headerH = 14, tableH = 97;
  p.box(10, y, 190, headerH + tableH);
  for (const x of [24, 44, 64, 108, 168, 184]) p.line(x, y, x, y + headerH + tableH);
  p.line(108, y + 7, 168, y + 7);
  for (const x of [120, 132, 144, 156]) p.line(x, y + 7, x, y + headerH + tableH);
  ['No.', '项目', '测量器具', '检验要求'].forEach((t, i) => p.text(t, xs[i], y, xs[i + 1] - xs[i], headerH, 8, true));
  p.text('抽 样', 108, y, 60, 7, 9, true);
  for (let i = 0; i < 5; i++) p.text(String(i + 1), 108 + i * 12, y + 7, 12, 7, 8, true);
  p.text('判定', 168, y, 16, headerH, 8, true); p.text('备注', 184, y, 16, headerH, 8, true);
  const initial = [
    ['1', '电线', '目视', '图纸对照'], ['2', '拉脱力', '拉力计', '按照图纸要求填写实际拉力'],
    ['3', '导线', '—', `耐压：1500V□ 900V□ ${yiwei ? '750' : '600'}V□`],
    ['4', yiwei ? '电测' : '测试项目', '测试机', yiwei ? '80A负载测试1H线温' : '绝缘电阻□  耐电压□'],
    ...(!yiwei ? [['5', '电测', '测试机', '线位：是否完全与图纸一致']] : []),
  ];
  const outside = ['连接器橡胶套本体无损伤、变形。', '端子无退PIN、翘PIN现象。', '产品整体表面清洁，无破损、变形', '确认颜色与插入孔位是否与图纸符合', '产品尺寸与图纸要求公差一致', '', '配件必须齐全，材料使用要求是否与图纸一致'];
  const n = initial.length + outside.length, rowH = tableH / n, start = y + headerH;
  p.line(10, start, 200, start);
  initial.forEach((row, i) => {
    row.forEach((value, j) => p.text(value, xs[j], start + i * rowH, xs[j + 1] - xs[j], rowH, j === 3 ? 7.6 : 8, j !== 3));
    p.line(10, start + (i + 1) * rowH, 200, start + (i + 1) * rowH);
  });
  const outsideTop = start + initial.length * rowH;
  p.text(yiwei ? '5' : '4', 10, outsideTop, 14, outside.length * rowH, 9, true);
  p.text('外观', 24, outsideTop, 20, outside.length * rowH, 9, true);
  p.text('目视', 44, outsideTop, 20, outside.length * rowH, 9, true);
  outside.forEach((value, i) => {
    if (i === 5) return;
    p.text(value, 64, outsideTop + i * rowH, 44, rowH * (i === 4 ? 2 : 1), 7.6);
  });
  for (let i = 1; i < outside.length; i++) p.line(i === 5 ? 108 : 64, outsideTop + i * rowH, 200, outsideTop + i * rowH);
  for (let i = 0; i < n; i++) p.text('合 · 否', 168, start + i * rowH, 16, rowH, 8, true);
  const end = y + headerH + tableH;
  p.cell('检查担当者：', 10, end, 112, 9); p.cell('确认责任者：', 122, end, 78, 9);
  p.cell('判定： 合 · 否', 10, end + 9, 98, 11, 10); p.cell('最终确认：合 · 否', 108, end + 9, 92, 11, 10);
  p.cell('测量工具', 10, end + 20, 40, 11, 8, true);
  p.cell('A. 钢尺  B. 游标卡尺  C. 千分尺  D. 卷尺  E. 拉力计', 50, end + 20, 150, 5.5, 7.5);
  p.cell('F. 通止规  G. 硬度计  H. 粗糙度仪  I. 试装配  J. 其他工具', 50, end + 25.5, 150, 5.5, 7.5);
  p.text('表格编号：HL-HK-007', 10, end + 31, 65, 6, 8); p.text('杭州杭连电子有限公司', 75, end + 31, 125, 6, 9, true);
}

function xinxinghuiReport(p: Paper, s: ShippingReportSnapshot) {
  p.text('杭州迈斯嘉电子科技有限公司', 10, 9, 190, 13, 19, true);
  p.text('出 厂 检 验 记 录 单', 10, 22, 190, 13, 19, true);
  p.text(`订单编号：${s.orderNo}`, 105, 35, 95, 8, 9);
  const widths = [28, 43, 29, 46, 17, 27]; let x = 10;
  ['产品名称', s.productName, '规格图号', s.specification, '数量', `${s.quantity} ${s.unit}`].forEach((t, i) => { p.cell(t, x, 43, widths[i], 14, i % 2 === 0 ? 9 : 8, i % 2 === 0); x += widths[i]; });
  x = 10;
  ['材料', '', '顾客名称', s.customerName, '检验人员', ''].forEach((t, i) => { p.cell(t, x, 57, widths[i], 14, i % 2 === 0 ? 9 : 8, i % 2 === 0); x += widths[i]; });
  const cols = [28, 43, 29, 17, 73], xs = [10, 38, 81, 110, 127];
  ['检验项目', '技术要求', '检验器具', '抽检数量', '检验结果记录'].forEach((t, i) => p.cell(t, xs[i], 71, cols[i], 12, 9, true));
  const rows: Array<[string, string, number]> = [ ['外观', '目测', 19], ['波纹管固定', '目测', 19], ['长度', '卷尺：0–5m', 14], ['连接线关系正确', '万用表', 18], ['屏蔽导通', '万用表', 14], ['绝缘电阻', '绝缘测试仪：', 21], ['耐电压', '耐压仪', 22], ['插件型号', '目测/对插', 26] ];
  let y = 83;
  rows.forEach(([name, tool, h]) => { [name, '', tool, '', ''].forEach((t, i) => p.cell(t, xs[i], y, cols[i], h, 9, true)); y += h; });
  p.cell('附件确认', 10, y, 28, 12, 9, true); p.cell('□材质报告               □尺寸报告               □性能报告', 38, y, 162, 12, 10, true); y += 12;
  p.cell('检验结论', 10, y, 28, 23, 10, true); p.box(38, y, 162, 23);
  p.text('□合格                          □不合格', 38, y, 162, 10, 11, true);
  p.text('检验：                 审核：                 日期：', 43, y + 12, 152, 10, 10, true); y += 23;
  p.cell('备注', 10, y, 28, 15, 10, true); p.cell('', 38, y, 162, 15);
}

export async function generateShippingReportPdf(snapshot: ShippingReportSnapshot, drawing?: Drawing, number?: string): Promise<{ bytes: Buffer; drawingPages: number }> {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(pdfFontkit);
  const font = await pdf.embedFont(await fontData(), { subset: true });
  const page = pdf.addPage([W, H]); const paper = new Paper(page, font);
  if (snapshot.template === 'xinxinghui') xinxinghuiReport(paper, snapshot); else standardReport(paper, snapshot);
  let drawingPages = 0;
  if (snapshot.drawing && drawing && snapshot.template !== 'xinxinghui') {
    const rect = { x: 13 * MM, y: H - 125 * MM, width: 184 * MM, height: 68 * MM };
    const place = (width: number, height: number) => { const scale = Math.min(rect.width / width, rect.height / height); return { x: rect.x + (rect.width - width * scale) / 2, y: rect.y + (rect.height - height * scale) / 2, width: width * scale, height: height * scale }; };
    try {
      if (drawing.mimeType === 'application/pdf') {
        const source = await PDFDocument.load(drawing.body); drawingPages = source.getPageCount();
        if (snapshot.drawing.page > drawingPages) throw new FinishedGoodsError(`该原图共 ${drawingPages} 页，请重新选择页码。`, 'REPORT_DRAWING_PAGE');
        const original = source.getPage(snapshot.drawing.page - 1);
        const [embedded] = await pdf.embedPdf(source, [snapshot.drawing.page - 1]);
        const turn = ((original.getRotation().angle % 360) + 360) % 360;
        const swapped = turn === 90 || turn === 270;
        const fitted = place(swapped ? embedded.height : embedded.width, swapped ? embedded.width : embedded.height);
        const width = swapped ? fitted.height : fitted.width, height = swapped ? fitted.width : fitted.height;
        // PDF /Rotate is clockwise, while a page drawing transform is counterclockwise.
        const x = fitted.x + (turn === 180 || turn === 270 ? fitted.width : 0);
        const y = fitted.y + (turn === 90 || turn === 180 ? fitted.height : 0);
        page.drawPage(embedded, { x, y, width, height, rotate: degrees(-turn) });
      } else {
        drawingPages = 1;
        if (snapshot.drawing.page !== 1) throw new FinishedGoodsError('图片只有 1 页', 'REPORT_DRAWING_PAGE');
        const bytes = await sharp(Buffer.from(drawing.body), { limitInputPixels: 80_000_000 }).rotate().resize({ width: 2600, height: 2600, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
        const embedded = await pdf.embedPng(bytes); page.drawImage(embedded, place(embedded.width, embedded.height));
      }
    } catch (error) {
      if (error instanceof FinishedGoodsError) throw error;
      throw new FinishedGoodsError('这份原图暂时无法嵌入，请重试、更换图页，或明确选择不附原图。', 'REPORT_DRAWING_UNREADABLE', 422);
    }
  }
  pdf.setTitle(`${number || '出货报告预览'} · ${snapshot.specification}`);
  pdf.setSubject(`${snapshot.customerName} · ${snapshot.quantity} ${snapshot.unit}`);
  pdf.setCreator('杭连 · 成品仓'); pdf.setProducer(`Shipping report ${snapshot.templateVersion}`);
  pdf.setAuthor(SHIPPING_REPORT_TEMPLATES.find(t => t.id === snapshot.template)!.company);
  return { bytes: Buffer.from(await pdf.save()), drawingPages };
}
