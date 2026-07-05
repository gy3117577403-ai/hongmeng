import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { safeDisplayFilename } from '@/lib/filenames';
import { logOp } from '@/lib/logs';
import { NativeUnauthorizedError, nativeError, nativeUnauthorized, requireNativeDownloadUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireNativeDownloadUser(req);
    const file = await prisma.resourceFile.findFirst({
      where: { id: params.id, deletedAt: null, status: 'uploaded' },
      select: { id: true, objectKey: true, originalName: true, displayName: true, mimeType: true, fileSize: true },
    });
    if (!file) return nativeError('文件不存在', 404);

    await logOp({ userId: user.id, action: 'download', targetType: 'resource_file', targetId: file.id, detail: { client: 'harmony_native' } });
    const stream = await getObjectStream(file.objectKey);
    const body = Readable.toWeb(stream as unknown as Readable) as unknown as BodyInit;
    return new Response(body, {
      headers: {
        'Content-Type': file.mimeType || 'application/octet-stream',
        'Content-Length': String(file.fileSize),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeDisplayFilename(file))}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '文件下载失败' }, { status: 500 });
  }
}
