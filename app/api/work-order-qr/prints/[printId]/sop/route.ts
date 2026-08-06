import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { safeDisplayFilename } from '@/lib/filenames';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function asciiFilename(filename: string) {
  return filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'sop.pdf';
}

export async function GET(_req: NextRequest, { params }: { params: { printId: string } }) {
  try {
    await requireUser();
    const print = await prisma.workOrderQrPrint.findUnique({
      where: { id: params.printId },
      select: { sopFileId: true },
    });
    if (!print?.sopFileId) {
      return NextResponse.json({ ok: false, error: '当前打印任务未包含 SOP' }, { status: 404 });
    }
    const file = await prisma.drawingLibraryFile.findFirst({
      where: {
        id: print.sopFileId,
        deletedAt: null,
        libraryItem: { deletedAt: null },
        category: { code: 'sop' },
      },
      select: { objectKey: true, originalName: true, displayName: true, mimeType: true, size: true },
    });
    if (!file) {
      return NextResponse.json({ ok: false, error: '打印快照中的 SOP 已被删除，请重新生成打印任务' }, { status: 410 });
    }
    const filename = safeDisplayFilename(file);
    const stream = await getObjectStream(file.objectKey);
    const body = Readable.toWeb(stream as unknown as Readable) as unknown as BodyInit;
    return new Response(body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(file.size),
        'Content-Disposition': `inline; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('load traveler SOP failed', error);
    return NextResponse.json({ ok: false, error: 'SOP 读取失败，请稍后重试' }, { status: 500 });
  }
}
