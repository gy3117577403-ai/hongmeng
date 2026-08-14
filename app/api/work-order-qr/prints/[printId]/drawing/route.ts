import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { safeDisplayFilename } from '@/lib/filenames';
import {
  buildPrintableSourcePdf,
  normalizedPrintFilename,
  PrintableDocumentError,
  printableSourceFormat,
  readPrintableSourceStream,
} from '@/lib/printable-document';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';
import { drawingImagePaperSizeFromSnapshot } from '@/lib/work-order-qr-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

function asciiFilename(filename: string) {
  return filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'drawing.pdf';
}

export async function GET(_req: NextRequest, { params }: { params: { printId: string } }) {
  try {
    await requireUser();
    const item = await prisma.workOrderQrPrintItem.findFirst({
      where: { printId: params.printId, material: 'DRAWING' },
      select: { fileId: true, print: { select: { snapshot: true } } },
    });
    if (!item?.fileId) {
      return NextResponse.json({ ok: false, error: '当前打印任务未包含原图' }, { status: 404 });
    }
    const file = await prisma.drawingLibraryFile.findFirst({
      where: {
        id: item.fileId,
        deletedAt: null,
        libraryItem: { deletedAt: null },
        category: { code: 'drawing' },
      },
      select: { objectKey: true, originalName: true, displayName: true, mimeType: true, size: true },
    });
    if (!file) {
      return NextResponse.json({ ok: false, error: '打印快照中的原图已被删除，请重新生成打印任务' }, { status: 410 });
    }
    const filename = safeDisplayFilename(file);
    const format = printableSourceFormat(filename, file.mimeType);
    if (!format) {
      return NextResponse.json({
        ok: false,
        error: `${filename} 的格式不支持打印；仅支持 PDF、JPG、JPEG、PNG、WebP`,
      }, { status: 409 });
    }
    const stream = await getObjectStream(file.objectKey);
    if (format !== 'pdf') {
      if (file.size > MAX_SOURCE_BYTES) {
        return NextResponse.json({ ok: false, error: `${filename} 超过 50MB，无法转换打印` }, { status: 413 });
      }
      const paperSize = drawingImagePaperSizeFromSnapshot(item.print.snapshot);
      const packet = await buildPrintableSourcePdf({
        bytes: await readPrintableSourceStream(stream, { fileName: filename, maxBytes: MAX_SOURCE_BYTES }),
        fileName: filename,
        mimeType: file.mimeType,
        imagePaperSize: paperSize,
        title: `${filename} 原图打印版`,
      });
      const printFilename = normalizedPrintFilename(filename);
      return new Response(Buffer.from(packet.bytes), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(packet.bytes.byteLength),
          'Content-Disposition': `inline; filename="${asciiFilename(printFilename)}"; filename*=UTF-8''${encodeURIComponent(printFilename)}`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'X-Print-Source-Format': format,
          'X-Print-Image-Paper-Size': paperSize,
          'X-Print-Packet-Pages': String(packet.pageCount),
        },
      });
    }
    const body = Readable.toWeb(stream as unknown as Readable) as unknown as BodyInit;
    return new Response(body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(file.size),
        'Content-Disposition': `inline; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Print-Source-Format': format,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof PrintableDocumentError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('load traveler drawing failed', error);
    return NextResponse.json({ ok: false, error: '原图读取失败，请稍后重试' }, { status: 500 });
  }
}
