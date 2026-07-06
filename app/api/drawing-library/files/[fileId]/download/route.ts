import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { safeDisplayFilename } from '@/lib/filenames';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { signedUrl } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { fileId: string } }) {
  try {
    const user = await requireUser();
    const file = await prisma.drawingLibraryFile.findFirst({
      where: { id: params.fileId, deletedAt: null, libraryItem: { deletedAt: null } },
    });
    if (!file) return NextResponse.json({ ok: false, error: '图纸资料文件不存在' }, { status: 404 });
    await logOp({ userId: user.id, action: 'download_drawing_library_file', targetType: 'drawing_library_file', targetId: file.id });
    return NextResponse.redirect(await signedUrl({ key: file.objectKey, filename: safeDisplayFilename(file), disposition: 'attachment', contentType: file.mimeType }));
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '图纸资料文件下载失败' }, { status: 500 });
  }
}
