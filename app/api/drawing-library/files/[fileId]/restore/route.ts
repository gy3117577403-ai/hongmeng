import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { fileId: string } }) {
  try {
    const user = await requireUser();
    const file = await prisma.drawingLibraryFile.update({
      where: { id: params.fileId },
      data: { deletedAt: null },
    });
    await prisma.drawingLibraryItem.update({ where: { id: file.libraryItemId }, data: { updatedAt: new Date() } });
    await logOp({ userId: user.id, action: 'restore_drawing_library_file', targetType: 'drawing_library_file', targetId: file.id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '图纸资料文件恢复失败' }, { status: 500 });
  }
}
