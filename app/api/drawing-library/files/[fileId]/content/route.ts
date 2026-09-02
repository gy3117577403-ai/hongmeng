import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { safeDisplayFilename } from '@/lib/filenames';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';
import { parseHttpByteRange } from '@/lib/http-byte-range';
import { beginRequestObservation, markRequest, observeResponse } from '@/lib/request-observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function contentTypeFor(file: { mimeType: string; originalName: string; displayName: string | null }) {
  const filename = safeDisplayFilename(file).toLowerCase();
  if (file.mimeType === 'application/pdf' || filename.endsWith('.pdf')) return 'application/pdf';
  return file.mimeType || 'application/octet-stream';
}

function asciiFilename(filename: string) {
  return filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'file.pdf';
}

async function findFile(fileId: string) {
  return prisma.drawingLibraryFile.findFirst({
    where: { id: fileId, deletedAt: null, libraryItem: { deletedAt: null } },
    select: { objectKey: true, originalName: true, displayName: true, mimeType: true, size: true },
  });
}

function contentHeaders(file: { mimeType: string; originalName: string; displayName: string | null; size: number }) {
  const filename = safeDisplayFilename(file);
  return {
    'Content-Type': contentTypeFor(file),
    'Content-Disposition': `inline; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'private, max-age=60, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  };
}

export async function HEAD(_req: NextRequest, { params }: { params: { fileId: string } }) {
  try {
    await requireUser();
    const file = await findFile(params.fileId);
    if (!file) return NextResponse.json({ ok: false, error: '图纸资料文件不存在或已删除' }, { status: 404 });
    return new Response(null, { headers: { ...contentHeaders(file), 'Content-Length': String(file.size) } });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    return NextResponse.json({ ok: false, error: '图纸资料文件读取失败' }, { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: { params: { fileId: string } }) {
  const observation = beginRequestObservation();
  try {
    await requireUser();
    markRequest(observation, 'auth');
    const file = await findFile(params.fileId);
    if (!file) return NextResponse.json({ ok: false, error: '图纸资料文件不存在或已删除' }, { status: 404 });
    const range = parseHttpByteRange(req.headers.get('range'), file.size);
    if (range === 'invalid') {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${file.size}`, 'Accept-Ranges': 'bytes' } });
    }
    markRequest(observation, 'metadata');
    const stream = await getObjectStream(file.objectKey, {
      range: range ? `bytes=${range.start}-${range.end}` : undefined,
      abortSignal: req.signal,
    });
    markRequest(observation, 'object_storage');
    const body = Readable.toWeb(stream as unknown as Readable) as unknown as BodyInit;
    const response = new NextResponse(body, {
      status: range ? 206 : 200,
      headers: {
        ...contentHeaders(file),
        'Content-Length': String(range?.length || file.size),
        ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${file.size}` } : {}),
      },
    });
    return observeResponse(observation, response);
  } catch (e) {
    if (e instanceof UnauthorizedError) return observeResponse(observation, unauthorized());
    console.error('drawing library content read failed', { requestId: observation.requestId, fileId: params.fileId, error: e });
    return observeResponse(observation, NextResponse.json({ ok: false, code: 'DRAWING_CONTENT_READ_FAILED', requestId: observation.requestId, error: '图纸资料文件读取失败' }, { status: 500 }));
  }
}
