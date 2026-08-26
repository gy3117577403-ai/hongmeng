import { createHash } from 'node:crypto';
import { PDFDocument, type PDFPage } from 'pdf-lib';
import { appendPrintableSource, type PrintableSourceInput } from '@/lib/printable-document';

export type WorkOrderPrintPacketTarget = 'all' | 'traveler' | 'warning' | 'traveler_warning' | 'sop';
export type WorkOrderPrintPacketMaterial = 'TRAVELER' | 'QUALITY_WARNING' | 'SOP' | 'DRAWING';

export type WorkOrderPrintPacketRecord = {
  printId: string;
  mode: string;
  items: Array<{
    material: string;
    copies: number;
    fileId: string | null;
  }>;
};

export class WorkOrderPrintPacketError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = 'PRINT_PACKET_INVALID') {
    super(message);
    this.name = 'WorkOrderPrintPacketError';
    this.status = status;
    this.code = code;
  }
}

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const DUPLEX_MODES = new Set([
  'TRAVELER_SOP_DUPLEX',
  'DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX',
]);

function materialItem(record: WorkOrderPrintPacketRecord, material: WorkOrderPrintPacketMaterial) {
  return record.items.find(item => item.material === material) || null;
}

function positiveCopies(value: number): number {
  return Number.isInteger(value) && value > 0 && value <= 10 ? value : 1;
}

function addBlankBack(output: PDFDocument, previousPage: PDFPage | undefined) {
  if (!previousPage) {
    output.addPage([A4_WIDTH, A4_HEIGHT]);
    return;
  }
  const blank = output.addPage([previousPage.getWidth(), previousPage.getHeight()]);
  blank.setRotation(previousPage.getRotation());
}

async function appendTravelerPages(
  output: PDFDocument,
  printId: string,
  travelerImages: ReadonlyMap<string, readonly Uint8Array[]>,
) {
  const pages = travelerImages.get(printId);
  if (!pages?.length) {
    throw new WorkOrderPrintPacketError('二维码流转单页面尚未生成，请刷新后重试', 400, 'PRINT_PACKET_TRAVELER_MISSING');
  }
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const imageBytes = pages[pageIndex];
    if (!imageBytes?.byteLength) {
      throw new WorkOrderPrintPacketError(`二维码流转单第 ${pageIndex + 1} 页缺失，请重新生成`, 400, 'PRINT_PACKET_TRAVELER_PAGE_MISSING');
    }
    let image;
    try {
      image = await output.embedPng(imageBytes);
    } catch {
      throw new WorkOrderPrintPacketError(`二维码流转单第 ${pageIndex + 1} 页格式无效，请刷新后重试`, 400, 'PRINT_PACKET_TRAVELER_INVALID');
    }
    const page = output.addPage([A4_WIDTH, A4_HEIGHT]);
    const scale = Math.min(A4_WIDTH / image.width, A4_HEIGHT / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, {
      x: (A4_WIDTH - width) / 2,
      y: (A4_HEIGHT - height) / 2,
      width,
      height,
    });
  }
}

async function appendWarningPages(
  output: PDFDocument,
  printId: string,
  warningImages: ReadonlyMap<string, readonly Uint8Array[]>,
) {
  const pages = warningImages.get(printId);
  if (!pages?.length) throw new WorkOrderPrintPacketError('异常警示附页尚未生成，请刷新后重试', 400, 'PRINT_PACKET_WARNING_MISSING');
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    let image;
    try {
      image = await output.embedPng(pages[pageIndex]);
    } catch {
      throw new WorkOrderPrintPacketError(`异常警示第 ${pageIndex + 1} 页格式无效`, 400, 'PRINT_PACKET_WARNING_INVALID');
    }
    const page = output.addPage([A4_WIDTH, A4_HEIGHT]);
    const scale = Math.min(A4_WIDTH / image.width, A4_HEIGHT / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, { x: (A4_WIDTH - width) / 2, y: (A4_HEIGHT - height) / 2, width, height });
  }
}

async function appendSourceFile(
  output: PDFDocument,
  fileId: string,
  sourceFiles: ReadonlyMap<string, PrintableSourceInput>,
): Promise<number> {
  const source = sourceFiles.get(fileId);
  if (!source?.bytes.byteLength) {
    throw new WorkOrderPrintPacketError('SOP 文件快照不存在，请重新生成打印任务', 410, 'PRINT_PACKET_SOP_MISSING');
  }
  return appendPrintableSource(output, source);
}

export async function buildWorkOrderPrintPacket(input: {
  records: readonly WorkOrderPrintPacketRecord[];
  target: WorkOrderPrintPacketTarget;
  travelerImages?: ReadonlyMap<string, readonly Uint8Array[]>;
  warningImages?: ReadonlyMap<string, readonly Uint8Array[]>;
  sourceFiles?: ReadonlyMap<string, PrintableSourceInput>;
}): Promise<{ bytes: Uint8Array; pageCount: number; hash: string }> {
  if (!input.records.length) {
    throw new WorkOrderPrintPacketError('打印任务为空', 400, 'PRINT_PACKET_EMPTY');
  }
  if (input.target === 'all' && input.records.some(record => !DUPLEX_MODES.has(record.mode))) {
    throw new WorkOrderPrintPacketError('当前资料组合不能生成双面打印包', 400, 'PRINT_PACKET_MODE_MISMATCH');
  }

  const output = await PDFDocument.create();
  output.setTitle(input.target === 'all' ? '生产流转单与SOP' : input.target === 'traveler' ? '生产流转单' : input.target === 'warning' ? '产品质量异常作业警示单' : input.target === 'traveler_warning' ? '生产流转单与异常警示' : '生产SOP');
  output.setCreator('杭连电子协同平台');
  output.setProducer('杭连电子协同平台');
  const travelerImages = input.travelerImages || new Map<string, readonly Uint8Array[]>();
  const warningImages = input.warningImages || new Map<string, readonly Uint8Array[]>();
  const sourceFiles = input.sourceFiles || new Map<string, PrintableSourceInput>();

  for (const record of input.records) {
    const traveler = materialItem(record, 'TRAVELER');
    const warning = materialItem(record, 'QUALITY_WARNING');
    const sop = materialItem(record, 'SOP');
    if (input.target === 'all') {
      if (!traveler || !sop?.fileId) {
        throw new WorkOrderPrintPacketError('双面打印任务缺少流转单或 SOP', 409, 'PRINT_PACKET_MATERIAL_MISSING');
      }
      const travelerCopies = positiveCopies(traveler.copies);
      const sopCopies = positiveCopies(sop.copies);
      if (travelerCopies !== sopCopies) {
        throw new WorkOrderPrintPacketError('双面打印时流转单与 SOP 份数必须一致', 409, 'PRINT_PACKET_COPY_MISMATCH');
      }
      for (let copy = 0; copy < travelerCopies; copy += 1) {
        const packetStart = output.getPageCount();
        await appendTravelerPages(output, record.printId, travelerImages);
        await appendSourceFile(output, sop.fileId, sourceFiles);
        const packetPageCount = output.getPageCount() - packetStart;
        if (packetPageCount % 2 === 1) {
          addBlankBack(output, output.getPages().at(-1));
        }
      }
      continue;
    }
    if (input.target === 'traveler_warning') {
      if (!traveler || !warning) throw new WorkOrderPrintPacketError('打印任务缺少流转单或异常警示附页', 409, 'PRINT_PACKET_MATERIAL_MISSING');
      for (let copy = 0; copy < positiveCopies(traveler.copies); copy += 1) await appendTravelerPages(output, record.printId, travelerImages);
      for (let copy = 0; copy < positiveCopies(warning.copies); copy += 1) await appendWarningPages(output, record.printId, warningImages);
      continue;
    }
    if (input.target === 'traveler' && traveler) {
      for (let copy = 0; copy < positiveCopies(traveler.copies); copy += 1) {
        await appendTravelerPages(output, record.printId, travelerImages);
      }
    }
    if (input.target === 'sop' && sop?.fileId) {
      for (let copy = 0; copy < positiveCopies(sop.copies); copy += 1) {
        await appendSourceFile(output, sop.fileId, sourceFiles);
      }
    }
    if (input.target === 'warning' && warning) {
      for (let copy = 0; copy < positiveCopies(warning.copies); copy += 1) await appendWarningPages(output, record.printId, warningImages);
    }
  }

  const pageCount = output.getPageCount();
  if (!pageCount) {
    throw new WorkOrderPrintPacketError('当前任务不包含该类打印资料', 400, 'PRINT_PACKET_TARGET_EMPTY');
  }
  const bytes = await output.save({ useObjectStreams: false, addDefaultPage: false, objectsPerTick: 50 });
  return {
    bytes,
    pageCount,
    hash: createHash('sha256').update(bytes).digest('hex'),
  };
}
