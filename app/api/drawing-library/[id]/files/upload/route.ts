import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { serializeDrawingLibraryFile } from '@/lib/drawing-library';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { putObject } from '@/lib/s3';
import { safeFilename, validateFile } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function ymd(d: Date) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function versionMinor(version?: string | null) {
  const m = String(version || '').match(/^V1\.(\d+)$/i);
  return m ? Number(m[1]) : -1;
}

async function nextVersion(libraryItemId: string, categoryId: string) {
  const files = await prisma.drawingLibraryFile.findMany({
    where: { libraryItemId, categoryId },
    select: { version: true },
  });
  const max = files.reduce((n, file) => Math.max(n, versionMinor(file.version)), -1);
  return `V1.${max + 1}`;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const categoryId = String(form.get('categoryId') || '');
    const up = form.get('file');
    if (!categoryId) return NextResponse.json({ ok: false, error: '请选择资料分类' }, { status: 400 });
    if (!(up instanceof File)) return NextResponse.json({ ok: false, error: '请选择文件' }, { status: 400 });
    const err = validateFile(up.name, up.type, up.size);
    if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 });

    const [item, category] = await Promise.all([
      prisma.drawingLibraryItem.findFirst({ where: { id: params.id, deletedAt: null } }),
      prisma.resourceCategory.findUnique({ where: { id: categoryId } }),
    ]);
    if (!item || !category) return NextResponse.json({ ok: false, error: '图纸资料记录或分类不存在' }, { status: 404 });

    const version = await nextVersion(item.id, category.id);
    const key = `drawing-library/${item.id}/${category.code}/${ymd(new Date())}/${crypto.randomUUID()}-${safeFilename(up.name)}`;
    await putObject({ key, body: Buffer.from(await up.arrayBuffer()), contentType: up.type || 'application/octet-stream', originalName: up.name });

    const file = await prisma.drawingLibraryFile.create({
      data: {
        libraryItemId: item.id,
        categoryId: category.id,
        originalName: up.name,
        mimeType: up.type || 'application/octet-stream',
        size: up.size,
        objectKey: key,
        version,
        uploadedById: user.id,
      },
      include: {
        category: { select: { id: true, name: true, code: true, sortOrder: true } },
        uploadedBy: { select: { displayName: true, username: true } },
      },
    });
    await prisma.drawingLibraryItem.update({ where: { id: item.id }, data: { updatedAt: new Date() } });
    await logOp({
      userId: user.id,
      action: 'upload_drawing_library_file',
      targetType: 'drawing_library_file',
      targetId: file.id,
      detail: { libraryKey: item.libraryKey, categoryCode: category.code, fileName: up.name, fileSize: up.size, version },
    });
    return NextResponse.json({ ok: true, file: serializeDrawingLibraryFile(file) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '图纸资料文件上传失败，请检查对象存储配置' }, { status: 500 });
  }
}
