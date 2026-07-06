import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { cleanDrawingText, serializeDrawingLibraryFile } from '@/lib/drawing-library';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { fileId: string } }) {
  try {
    const user = await requireUser();
    const old = await prisma.drawingLibraryFile.findFirst({
      where: { id: params.fileId, deletedAt: null, libraryItem: { deletedAt: null } },
    });
    if (!old) return NextResponse.json({ ok: false, error: '图纸资料文件不存在' }, { status: 404 });
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
    const file = await prisma.drawingLibraryFile.update({
      where: { id: old.id },
      data,
      include: {
        category: { select: { id: true, name: true, code: true, sortOrder: true } },
        uploadedBy: { select: { displayName: true, username: true } },
      },
    });
    await prisma.drawingLibraryItem.update({ where: { id: file.libraryItemId }, data: { updatedAt: new Date() } });
    await logOp({ userId: user.id, action: 'update_drawing_library_file', targetType: 'drawing_library_file', targetId: file.id, detail: { hasDisplayName: !!file.displayName, hasRemark: !!file.remark } });
    return NextResponse.json({ ok: true, file: serializeDrawingLibraryFile(file) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '图纸资料文件保存失败' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { fileId: string } }) {
  try {
    const user = await requireUser();
    const file = await prisma.drawingLibraryFile.findFirst({
      where: { id: params.fileId, deletedAt: null, libraryItem: { deletedAt: null } },
    });
    if (!file) return NextResponse.json({ ok: false, error: '图纸资料文件不存在' }, { status: 404 });
    await prisma.drawingLibraryFile.update({ where: { id: file.id }, data: { deletedAt: new Date() } });
    await prisma.drawingLibraryItem.update({ where: { id: file.libraryItemId }, data: { updatedAt: new Date() } });
    await logOp({ userId: user.id, action: 'delete_drawing_library_file', targetType: 'drawing_library_file', targetId: file.id, detail: { softDelete: true } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '图纸资料文件删除失败' }, { status: 500 });
  }
}
