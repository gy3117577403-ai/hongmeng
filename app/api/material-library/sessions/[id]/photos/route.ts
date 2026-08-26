import crypto from 'node:crypto';
import { MaterialLibraryCaptureStatus, Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { requireUser } from '@/lib/auth';
import {
  cleanMaterialText,
  materialLibraryActor,
  materialLibraryItemLockKey,
  materialLibrarySessionInclude,
  serializeMaterialSession,
} from '@/lib/material-library';
import { materialLibraryRouteError } from '@/lib/material-library-http';
import { prisma } from '@/lib/prisma';
import { deleteObjectsBestEffort, putObject } from '@/lib/s3';
import { safeFilename, validateFileContent } from '@/lib/validation';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { orientedImageSize } from '@/lib/image-orientation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function datePart(date = new Date()) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let objectKey: string | null = null;
  try {
    assertSameOriginMutationRequest(request);
    const user = await requireUser();
    const actor = materialLibraryActor(user);
    const form = await request.formData();
    const upload = form.get('file');
    if (!(upload instanceof File)) return NextResponse.json({ ok: false, error: '请选择要上传的物料照片' }, { status: 400 });
    const session = await prisma.materialLibraryCaptureSession.findUnique({ where: { id: params.id } });
    if (!session) return NextResponse.json({ ok: false, error: '拍照录入会话不存在' }, { status: 404 });
    if (session.status !== MaterialLibraryCaptureStatus.ACTIVE) {
      return NextResponse.json({ ok: false, error: '该录入会话已结束，不能继续上传照片' }, { status: 409 });
    }

    const body = Buffer.from(await upload.arrayBuffer());
    const validationError = validateFileContent(upload.name, upload.type, upload.size, body);
    if (validationError) return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
    if (!upload.type.startsWith('image/')) return NextResponse.json({ ok: false, error: '物料照片仅支持 JPG、PNG 或 WEBP 图片' }, { status: 400 });
    const metadata = await sharp(body, { failOn: 'error' }).metadata().catch(() => null);
    if (!metadata?.width || !metadata.height) return NextResponse.json({ ok: false, error: '无法识别图片尺寸，请重新拍照' }, { status: 400 });
    const displaySize = orientedImageSize(metadata);
    if (!displaySize) return NextResponse.json({ ok: false, error: '无法识别图片显示方向，请重新拍照' }, { status: 400 });

    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    objectKey = `material-library/${session.materialItemId}/${datePart()}/sha256-${sha256}-${crypto.randomUUID()}-${safeFilename(upload.name)}`;
    await putObject({
      key: objectKey,
      body,
      contentType: upload.type,
      originalName: upload.name,
    });

    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${materialLibraryItemLockKey(session.materialItemId)}))`;
      const fresh = await tx.materialLibraryCaptureSession.findUnique({ where: { id: session.id } });
      if (!fresh) throw new Error('MATERIAL_SESSION_NOT_FOUND');
      if (fresh.status !== MaterialLibraryCaptureStatus.ACTIVE) throw new Error('MATERIAL_SESSION_CLOSED');
      const [activePhotoCount, order] = await Promise.all([
        tx.materialLibraryPhoto.count({ where: { materialItemId: fresh.materialItemId, deletedAt: null } }),
        tx.materialLibraryPhoto.aggregate({
          where: { materialItemId: fresh.materialItemId, deletedAt: null },
          _max: { sortOrder: true },
        }),
      ]);
      const photo = await tx.materialLibraryPhoto.create({
        data: {
          sessionId: fresh.id,
          materialItemId: fresh.materialItemId,
          originalName: upload.name,
          mimeType: upload.type,
          size: BigInt(upload.size),
          objectKey: objectKey!,
          sha256,
          width: displaySize.width,
          height: displaySize.height,
          sortOrder: (order._max.sortOrder ?? -1) + 1,
          isCover: activePhotoCount === 0,
          caption: cleanMaterialText(form.get('caption'), 500),
          captureSource: cleanMaterialText(form.get('captureSource'), 40) || 'MOBILE_CAMERA',
          uploadedById: actor.id,
          uploadedByName: actor.name,
        },
      });
      await tx.materialLibraryCaptureSession.update({ where: { id: fresh.id }, data: { lastSeenAt: new Date() } });
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'upload_material_library_photo',
          targetType: 'material_library_photo',
          targetId: photo.id,
          detail: {
            sessionId: fresh.id,
            materialItemId: fresh.materialItemId,
            size: upload.size,
            sha256,
            width: displaySize.width,
            height: displaySize.height,
            exifOrientation: metadata.orientation || null,
          },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    objectKey = null;

    const updated = await prisma.materialLibraryCaptureSession.findUnique({ where: { id: session.id }, include: materialLibrarySessionInclude });
    if (!updated) throw new Error('MATERIAL_SESSION_NOT_FOUND');
    return NextResponse.json({ ok: true, session: serializeMaterialSession(updated) }, { status: 201 });
  } catch (error) {
    if (objectKey) await deleteObjectsBestEffort([objectKey]);
    if (error instanceof Error) {
      if (error.message === 'MATERIAL_SESSION_NOT_FOUND') return NextResponse.json({ ok: false, error: '拍照录入会话不存在' }, { status: 404 });
      if (error.message === 'MATERIAL_SESSION_CLOSED') return NextResponse.json({ ok: false, error: '该录入会话已结束，不能继续上传照片' }, { status: 409 });
    }
    return materialLibraryRouteError(error, '物料照片上传失败，请检查对象存储');
  }
}
