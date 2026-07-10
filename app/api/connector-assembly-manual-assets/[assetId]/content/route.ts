import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function asciiFilename(filename: string): string {
  return filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'manual-file';
}

export async function GET(_req: Request, { params }: { params: { assetId: string } }) {
  try {
    await requireUser();
    const asset = await prisma.connectorAssemblyManualAsset.findFirst({
      where: { id: params.assetId, deletedAt: null, version: { deletedAt: null, manual: { deletedAt: null } } },
      select: { objectKey: true, originalName: true, displayName: true, mimeType: true, size: true },
    });
    if (!asset) return NextResponse.json({ ok: false, error: '说明书文件不存在或已删除' }, { status: 404 });
    const filename = asset.displayName?.trim() || asset.originalName;
    const stream = await getObjectStream(asset.objectKey);
    const body = Readable.toWeb(stream as Readable) as unknown as BodyInit;
    return new Response(body, {
      headers: {
        'Content-Type': asset.mimeType || 'application/octet-stream',
        'Content-Length': String(asset.size),
        'Content-Disposition': `inline; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '说明书文件读取失败' }, { status: 500 });
  }
}
