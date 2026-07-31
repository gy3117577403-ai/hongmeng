import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { synchronizeDrawingLibraryWorkOrderStatus } from '@/lib/drawing-library-lifecycle';
import { prisma } from '@/lib/prisma';
import { assertCommonDrawingFileLifecycleAllowed, SopRequestError } from '@/lib/sop';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { fileId: string } }) {
  try {
    const user = await requireUser();
    const deletedFile = await prisma.drawingLibraryFile.findFirst({
      where: { id: params.fileId, deletedAt: { not: null }, libraryItem: { deletedAt: null } },
      include: { category: { select: { code: true } } },
    });
    if (!deletedFile) return NextResponse.json({ ok: false, error: '回收站中未找到该文件' }, { status: 404 });
    assertCommonDrawingFileLifecycleAllowed(deletedFile, 'restore');
    const sync = await prisma.$transaction(async tx => {
      await tx.drawingLibraryFile.update({ where: { id: deletedFile.id }, data: { deletedAt: null } });
      await tx.drawingLibraryItem.update({ where: { id: deletedFile.libraryItemId }, data: { updatedAt: new Date() } });
      const workOrderSync = await synchronizeDrawingLibraryWorkOrderStatus(tx, deletedFile.libraryItemId);
      await tx.operationLog.create({
        data: {
          userId: user.id,
          action: 'restore_drawing_library_file',
          targetType: 'drawing_library_file',
          targetId: deletedFile.id,
          detail: { categoryCode: deletedFile.category.code, ...workOrderSync },
        },
      });
      return workOrderSync;
    });
    return NextResponse.json({ ok: true, sync });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    if (e instanceof SopRequestError) {
      return NextResponse.json(
        { ok: false, error: e.message, message: e.message, code: e.code, detail: e.detail },
        { status: e.status },
      );
    }
    console.error(e);
    return NextResponse.json({ ok: false, error: '图纸资料文件恢复失败' }, { status: 500 });
  }
}
