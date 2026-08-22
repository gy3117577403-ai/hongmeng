import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { cleanDrawingText, serializeDrawingLibraryFile } from '@/lib/drawing-library';
import { synchronizeDrawingLibraryWorkOrderStatus } from '@/lib/drawing-library-lifecycle';
import { prisma } from '@/lib/prisma';
import { assertCommonDrawingFileLifecycleAllowed, SopRequestError } from '@/lib/sop';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { fileId: string } }) {
  try {
    const user = await requireUser();
    const old = await prisma.drawingLibraryFile.findFirst({
      where: { id: params.fileId, deletedAt: null, libraryItem: { deletedAt: null } },
    });
    if (!old) return NextResponse.json({ ok: false, error: '图纸资料文件不存在' }, { status: 404 });
    assertCommonDrawingFileLifecycleAllowed(old, 'update');
    const body = await req.json().catch(() => ({}));
    const data: { displayName?: string | null; remark?: string | null; categoryId?: string } = {};
    if (body.displayName !== undefined) data.displayName = cleanDrawingText(body.displayName, 160);
    if (body.remark !== undefined) data.remark = cleanDrawingText(body.remark, 500);
    if (typeof body.categoryId === 'string' && body.categoryId.trim() && body.categoryId !== old.categoryId) {
      const category = await prisma.resourceCategory.findUnique({ where: { id: body.categoryId } });
      if (!category) return NextResponse.json({ ok: false, error: '目标分类不存在' }, { status: 404 });
      data.categoryId = category.id;
    }
    if (!Object.keys(data).length) return NextResponse.json({ ok: false, error: '没有可更新字段' }, { status: 400 });
    const result = await prisma.$transaction(async tx => {
      const file = await tx.drawingLibraryFile.update({
        where: { id: old.id },
        data,
        include: {
          category: { select: { id: true, name: true, code: true, sortOrder: true } },
          uploadedBy: { select: { displayName: true, username: true } },
          sourcePdfOverlayVersion: { select: { controlMode: true } },
          sourceSopVersion: { select: { controlMode: true } },
        },
      });
      await tx.drawingLibraryItem.update({ where: { id: file.libraryItemId }, data: { updatedAt: new Date() } });
      const sync = await synchronizeDrawingLibraryWorkOrderStatus(tx, file.libraryItemId);
      await tx.operationLog.create({
        data: {
          userId: user.id,
          action: 'update_drawing_library_file',
          targetType: 'drawing_library_file',
          targetId: file.id,
          detail: {
            hasDisplayName: !!file.displayName,
            hasRemark: !!file.remark,
            categoryChanged: old.categoryId !== file.categoryId,
            categoryCode: file.category.code,
            ...sync,
          },
        },
      });
      return { file, sync };
    });
    return NextResponse.json({ ok: true, file: serializeDrawingLibraryFile(result.file), sync: result.sync });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    if (e instanceof SopRequestError) {
      return NextResponse.json(
        { ok: false, error: e.message, message: e.message, code: e.code, detail: e.detail },
        { status: e.status },
      );
    }
    console.error(e);
    return NextResponse.json({ ok: false, error: '图纸资料文件保存失败' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { fileId: string } }) {
  try {
    const user = await requireUser();
    const file = await prisma.drawingLibraryFile.findFirst({
      where: { id: params.fileId, deletedAt: null, libraryItem: { deletedAt: null } },
      include: { category: { select: { code: true } } },
    });
    if (!file) return NextResponse.json({ ok: false, error: '图纸资料文件不存在' }, { status: 404 });
    assertCommonDrawingFileLifecycleAllowed(file, 'delete');
    const sync = await prisma.$transaction(async tx => {
      await tx.drawingLibraryFile.update({ where: { id: file.id }, data: { deletedAt: new Date() } });
      await tx.drawingLibraryItem.update({ where: { id: file.libraryItemId }, data: { updatedAt: new Date() } });
      const workOrderSync = await synchronizeDrawingLibraryWorkOrderStatus(tx, file.libraryItemId);
      await tx.operationLog.create({
        data: {
          userId: user.id,
          action: 'delete_drawing_library_file',
          targetType: 'drawing_library_file',
          targetId: file.id,
          detail: { softDelete: true, categoryCode: file.category.code, ...workOrderSync },
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
    return NextResponse.json({ ok: false, error: '图纸资料文件删除失败' }, { status: 500 });
  }
}
