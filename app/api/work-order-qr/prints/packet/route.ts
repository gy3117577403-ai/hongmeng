import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { safeDisplayFilename } from '@/lib/filenames';
import {
  PrintableDocumentError,
  printableSourceFormat,
  readPrintableSourceStream,
  type PrintableSourceInput,
} from '@/lib/printable-document';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';
import {
  buildWorkOrderPrintPacket,
  type WorkOrderPrintPacketTarget,
  WorkOrderPrintPacketError,
} from '@/lib/work-order-print-packet';
import {
  loadWorkOrderTravelerPrints,
  WorkOrderQrServiceError,
} from '@/lib/work-order-qr-service';
import { validateTravelerPageManifest } from '@/lib/work-order-traveler-layout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TRAVELER_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TRAVELER_IMAGE_TOTAL_BYTES = 60 * 1024 * 1024;
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_SOURCE_TOTAL_BYTES = 160 * 1024 * 1024;

function packetTarget(value: FormDataEntryValue | null): WorkOrderPrintPacketTarget {
  if (value === 'all' || value === 'traveler' || value === 'warning' || value === 'traveler_warning' || value === 'sop') return value;
  throw new WorkOrderPrintPacketError('打印资料类型无效', 400, 'PRINT_PACKET_TARGET_INVALID');
}

function packetFilename(target: WorkOrderPrintPacketTarget) {
  if (target === 'all') return 'production-traveler-sop.pdf';
  if (target === 'traveler') return 'production-traveler.pdf';
  if (target === 'warning') return 'production-quality-warning.pdf';
  if (target === 'traveler_warning') return 'production-traveler-quality-warning.pdf';
  return 'production-sop.pdf';
}

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const form = await req.formData();
    const target = packetTarget(form.get('target'));
    const printIds = String(form.get('printIds') || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);
    const records = await loadWorkOrderTravelerPrints(printIds);

    const travelerImages = new Map<string, readonly Uint8Array[]>();
    let travelerImageTotal = 0;
    if (target === 'all' || target === 'traveler' || target === 'traveler_warning') {
      for (const record of records) {
        if (!record.items.some(item => item.material === 'TRAVELER')) continue;
        const manifestEntry = form.get(`travelerManifest:${record.printId}`);
        if (typeof manifestEntry !== 'string' || !manifestEntry.trim() || Buffer.byteLength(manifestEntry, 'utf8') > 32 * 1024) {
          throw new WorkOrderPrintPacketError('二维码流转单分页清单缺失，请刷新后重试', 400, 'PRINT_PACKET_TRAVELER_MANIFEST_MISSING');
        }
        let manifestInput: unknown;
        try {
          manifestInput = JSON.parse(manifestEntry);
        } catch {
          throw new WorkOrderPrintPacketError('二维码流转单分页清单格式无效', 400, 'PRINT_PACKET_TRAVELER_MANIFEST_INVALID');
        }
        let manifest;
        try {
          manifest = validateTravelerPageManifest(manifestInput, record.snapshot.steps.length);
        } catch (error) {
          throw new WorkOrderPrintPacketError(
            error instanceof Error ? error.message : '二维码流转单分页清单无效',
            400,
            'PRINT_PACKET_TRAVELER_MANIFEST_INVALID',
          );
        }
        const pageImages: Uint8Array[] = [];
        for (const page of manifest.pages) {
          const entry = form.get(`travelerImage:${record.printId}:${page.pageNumber}`);
          if (!(entry instanceof File) || !entry.size) {
            throw new WorkOrderPrintPacketError(`二维码流转单第 ${page.pageNumber} 页缺失，请重新生成`, 400, 'PRINT_PACKET_TRAVELER_PAGE_MISSING');
          }
          if (entry.type && entry.type !== 'image/png') {
            throw new WorkOrderPrintPacketError(`二维码流转单第 ${page.pageNumber} 页格式无效`, 400, 'PRINT_PACKET_TRAVELER_INVALID');
          }
          if (entry.size > MAX_TRAVELER_IMAGE_BYTES) {
            throw new WorkOrderPrintPacketError(`二维码流转单第 ${page.pageNumber} 页超过 8MB，请减少批量后重试`, 413, 'PRINT_PACKET_TRAVELER_TOO_LARGE');
          }
          travelerImageTotal += entry.size;
          if (travelerImageTotal > MAX_TRAVELER_IMAGE_TOTAL_BYTES) {
            throw new WorkOrderPrintPacketError('本次流转单页面总量过大，请分批打印', 413, 'PRINT_PACKET_TRAVELER_BATCH_TOO_LARGE');
          }
          pageImages.push(new Uint8Array(await entry.arrayBuffer()));
        }
        travelerImages.set(record.printId, pageImages);
      }
    }

    const warningImages = new Map<string, readonly Uint8Array[]>();
    let warningImageTotal = 0;
    if (target === 'warning' || target === 'traveler_warning') {
      for (const record of records) {
        if (!record.items.some(item => item.material === 'QUALITY_WARNING')) continue;
        const expectedPages = record.snapshot.qualityWarnings.length;
        if (!expectedPages) throw new WorkOrderPrintPacketError('异常警示打印快照为空，请重新生成打印任务', 410, 'PRINT_PACKET_WARNING_SNAPSHOT_EMPTY');
        const pages: Uint8Array[] = [];
        for (let pageIndex = 0; pageIndex < expectedPages; pageIndex += 1) {
          const entry = form.get(`warningImage:${record.printId}:${pageIndex + 1}`);
          if (!(entry instanceof File) || !entry.size || (entry.type && entry.type !== 'image/png')) {
            throw new WorkOrderPrintPacketError(`异常警示第 ${pageIndex + 1} 页缺失或格式无效`, 400, 'PRINT_PACKET_WARNING_PAGE_MISSING');
          }
          if (entry.size > MAX_TRAVELER_IMAGE_BYTES) throw new WorkOrderPrintPacketError(`异常警示第 ${pageIndex + 1} 页超过 8MB`, 413, 'PRINT_PACKET_WARNING_TOO_LARGE');
          warningImageTotal += entry.size;
          if (warningImageTotal > MAX_TRAVELER_IMAGE_TOTAL_BYTES) throw new WorkOrderPrintPacketError('本次异常警示页面总量过大，请分批打印', 413, 'PRINT_PACKET_WARNING_BATCH_TOO_LARGE');
          pages.push(new Uint8Array(await entry.arrayBuffer()));
        }
        warningImages.set(record.printId, pages);
      }
    }

    const sourceFiles = new Map<string, PrintableSourceInput>();
    if (target === 'all' || target === 'sop') {
      const fileIds = [...new Set(records.flatMap(record => record.items
        .filter(item => item.material === 'SOP' && item.fileId)
        .map(item => item.fileId as string)))];
      if (fileIds.length) {
        const files = await prisma.drawingLibraryFile.findMany({
          where: {
            id: { in: fileIds },
            deletedAt: null,
            libraryItem: { deletedAt: null },
            category: { code: 'sop' },
          },
          select: { id: true, objectKey: true, originalName: true, displayName: true, mimeType: true, size: true },
        });
        if (files.length !== fileIds.length) {
          throw new WorkOrderPrintPacketError('部分 SOP 打印快照已被删除，请重新生成打印任务', 410, 'PRINT_PACKET_SOP_MISSING');
        }
        let sourceTotal = 0;
        for (const file of files) {
          const fileName = safeDisplayFilename(file);
          if (!printableSourceFormat(fileName, file.mimeType)) {
            throw new WorkOrderPrintPacketError(
              `${fileName} 的格式不支持打印；仅支持 PDF、JPG、JPEG、PNG、WebP`,
              409,
              'PRINT_PACKET_SOURCE_FORMAT_UNSUPPORTED',
            );
          }
          if (file.size > MAX_SOURCE_BYTES) {
            throw new WorkOrderPrintPacketError(`${fileName} 超过 50MB，请分开打印`, 413, 'PRINT_PACKET_SOURCE_TOO_LARGE');
          }
          sourceTotal += file.size;
          if (sourceTotal > MAX_SOURCE_TOTAL_BYTES) {
            throw new WorkOrderPrintPacketError('本次 SOP 总量过大，请分批打印', 413, 'PRINT_PACKET_SOP_BATCH_TOO_LARGE');
          }
          const body = await readPrintableSourceStream(await getObjectStream(file.objectKey), {
            fileName,
            maxBytes: MAX_SOURCE_BYTES,
          });
          sourceFiles.set(file.id, {
            bytes: body,
            fileName,
            mimeType: file.mimeType,
            imagePaperSize: 'A4',
          });
        }
      }
    }

    const packet = await buildWorkOrderPrintPacket({ records, target, travelerImages, warningImages, sourceFiles });
    return new Response(Buffer.from(packet.bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(packet.bytes.byteLength),
        'Content-Disposition': `inline; filename="${packetFilename(target)}"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'X-Print-Packet-Hash': packet.hash,
        'X-Print-Packet-Pages': String(packet.pageCount),
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (
      error instanceof WorkOrderQrServiceError
      || error instanceof WorkOrderPrintPacketError
      || error instanceof PrintableDocumentError
    ) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('build work-order print packet failed', error);
    return NextResponse.json({ ok: false, error: '打印文件生成失败，请稍后重试' }, { status: 500 });
  }
}
