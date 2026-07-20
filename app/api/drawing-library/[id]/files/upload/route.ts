import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { serializeDrawingLibraryFile } from '@/lib/drawing-library';
import { logOp } from '@/lib/logs';
import { reconcileProductionPlanDrawingLinks } from '@/lib/planning-product-link';
import { prisma } from '@/lib/prisma';
import { deleteObjectsBestEffort, putObject } from '@/lib/s3';
import { safeFilename, validateFileContent } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function ymd(d: Date) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function cleanText(value: FormDataEntryValue | null, max = 200) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

function versionMinor(version?: string | null) {
  const m = String(version || '').match(/^V1\.(\d+)$/i);
  return m ? Number(m[1]) : -1;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const categoryId = String(form.get('categoryId') || '').trim();
    const categoryName = String(form.get('categoryName') || '').trim();
    const displayName = cleanText(form.get('displayName'), 160);
    const remark = cleanText(form.get('remark'), 500);
    const up = form.get('file');
    if (!categoryId && !categoryName) return NextResponse.json({ ok: false, error: '请选择资料分类' }, { status: 400 });
    if (!(up instanceof File)) return NextResponse.json({ ok: false, error: '请选择文件' }, { status: 400 });
    const body = Buffer.from(await up.arrayBuffer());
    const err = validateFileContent(up.name, up.type, up.size, body);
    if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 });

    const [item, category] = await Promise.all([
      prisma.drawingLibraryItem.findFirst({ where: { id: params.id, deletedAt: null } }),
      categoryId
        ? prisma.resourceCategory.findUnique({ where: { id: categoryId } })
        : prisma.resourceCategory.findFirst({ where: { OR: [{ name: categoryName }, { code: categoryName }] } }),
    ]);
    if (!item || !category) return NextResponse.json({ ok: false, error: '图纸资料记录或分类不存在' }, { status: 404 });

    const key = `drawing-library/${item.id}/${category.code}/${ymd(new Date())}/${crypto.randomUUID()}-${safeFilename(up.name)}`;
    await putObject({ key, body, contentType: up.type || 'application/octet-stream', originalName: up.name });

    let file;
    try {
      file = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`drawing-library:${item.id}:${category.id}`}))`;
        const files = await tx.drawingLibraryFile.findMany({
          where: { libraryItemId: item.id, categoryId: category.id },
          select: { version: true },
        });
        const version = `V1.${files.reduce((n, existing) => Math.max(n, versionMinor(existing.version)), -1) + 1}`;
        const created = await tx.drawingLibraryFile.create({
          data: {
            libraryItemId: item.id,
            categoryId: category.id,
            originalName: up.name,
            displayName,
            mimeType: up.type || 'application/octet-stream',
            size: up.size,
            objectKey: key,
            version,
            uploadedById: user.id,
            remark,
          },
          include: {
            category: { select: { id: true, name: true, code: true, sortOrder: true } },
            uploadedBy: { select: { displayName: true, username: true } },
          },
        });
        await tx.drawingLibraryItem.update({ where: { id: item.id }, data: { updatedAt: new Date() } });
        await reconcileProductionPlanDrawingLinks(tx, { drawingLibraryItemId: item.id });
        return created;
      });
    } catch (error) {
      await deleteObjectsBestEffort([key]);
      throw error;
    }
    const version = file.version;
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
