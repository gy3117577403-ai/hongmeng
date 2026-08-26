import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { materialLibraryRouteError } from '@/lib/material-library-http';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function asciiFilename(filename: string) {
  return filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'supplier-specification';
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const document = await prisma.materialLibrarySpecificationDocument.findFirst({
      where: { id: params.id, deletedAt: null, supplierVariant: { deletedAt: null, materialItem: { deletedAt: null } } },
      select: { objectKey: true, originalName: true, mimeType: true, size: true },
    });
    if (!document) return NextResponse.json({ ok: false, error: '供应商规格书不存在或已删除' }, { status: 404 });
    const source = await getObjectStream(document.objectKey);
    const body = Readable.toWeb(source as unknown as Readable) as unknown as BodyInit;
    return new NextResponse(body, {
      headers: {
        'Content-Type': document.mimeType,
        'Content-Length': String(document.size),
        'Content-Disposition': `inline; filename="${asciiFilename(document.originalName)}"; filename*=UTF-8''${encodeURIComponent(document.originalName)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return materialLibraryRouteError(error, '供应商规格书读取失败');
  }
}
