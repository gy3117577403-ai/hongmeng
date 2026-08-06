import { createHash } from 'node:crypto';
import { PDFDocument, type PDFPage } from 'pdf-lib';

export type WorkOrderPrintPacketTarget = 'all' | 'traveler' | 'sop';
export type WorkOrderPrintPacketMaterial = 'TRAVELER' | 'SOP' | 'DRAWING';

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

async function appendTraveler(
  output: PDFDocument,
  printId: string,
  travelerImages: ReadonlyMap<string, Uint8Array>,
) {
  const imageBytes = travelerImages.get(printId);
  if (!imageBytes?.byteLength) {
    throw new WorkOrderPrintPacketError('二维码流转单页面尚未生成，请刷新后重试', 400, 'PRINT_PACKET_TRAVELER_MISSING');
  }
  let image;
  try {
    image = await output.embedPng(imageBytes);
  } catch {
    throw new WorkOrderPrintPacketError('二维码流转单页面格式无效，请刷新后重试', 400, 'PRINT_PACKET_TRAVELER_INVALID');
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

async function appendSourcePdf(
  output: PDFDocument,
  fileId: string,
  sourcePdfs: ReadonlyMap<string, Uint8Array>,
): Promise<number> {
  const bytes = sourcePdfs.get(fileId);
  if (!bytes?.byteLength) {
    throw new WorkOrderPrintPacketError('SOP 文件快照不存在，请重新生成打印任务', 410, 'PRINT_PACKET_SOP_MISSING');
  }
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  } catch {
    throw new WorkOrderPrintPacketError('SOP PDF 已加密或损坏，无法合并；请打开原文件打印', 409, 'PRINT_PACKET_SOP_INVALID');
  }
  if (!source.getPageCount()) {
    throw new WorkOrderPrintPacketError('SOP PDF 没有可打印页面', 409, 'PRINT_PACKET_SOP_EMPTY');
  }
  const pages = await output.copyPages(source, source.getPageIndices());
  pages.forEach(page => output.addPage(page));
  return pages.length;
}

export async function buildWorkOrderPrintPacket(input: {
  records: readonly WorkOrderPrintPacketRecord[];
  target: WorkOrderPrintPacketTarget;
  travelerImages?: ReadonlyMap<string, Uint8Array>;
  sourcePdfs?: ReadonlyMap<string, Uint8Array>;
}): Promise<{ bytes: Uint8Array; pageCount: number; hash: string }> {
  if (!input.records.length) {
    throw new WorkOrderPrintPacketError('打印任务为空', 400, 'PRINT_PACKET_EMPTY');
  }
  if (input.target === 'all' && input.records.some(record => !DUPLEX_MODES.has(record.mode))) {
    throw new WorkOrderPrintPacketError('当前资料组合不能生成双面打印包', 400, 'PRINT_PACKET_MODE_MISMATCH');
  }

  const output = await PDFDocument.create();
  output.setTitle(input.target === 'all' ? '生产流转单与SOP' : input.target === 'traveler' ? '生产流转单' : '生产SOP');
  output.setCreator('杭连电子协同平台');
  output.setProducer('杭连电子协同平台');
  const travelerImages = input.travelerImages || new Map<string, Uint8Array>();
  const sourcePdfs = input.sourcePdfs || new Map<string, Uint8Array>();

  for (const record of input.records) {
    const traveler = materialItem(record, 'TRAVELER');
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
        await appendTraveler(output, record.printId, travelerImages);
        await appendSourcePdf(output, sop.fileId, sourcePdfs);
        const packetPageCount = output.getPageCount() - packetStart;
        if (packetPageCount % 2 === 1) {
          addBlankBack(output, output.getPages().at(-1));
        }
      }
      continue;
    }
    if (input.target === 'traveler' && traveler) {
      for (let copy = 0; copy < positiveCopies(traveler.copies); copy += 1) {
        await appendTraveler(output, record.printId, travelerImages);
      }
    }
    if (input.target === 'sop' && sop?.fileId) {
      for (let copy = 0; copy < positiveCopies(sop.copies); copy += 1) {
        await appendSourcePdf(output, sop.fileId, sourcePdfs);
      }
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
