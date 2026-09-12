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
  serializeMaterialPhoto,
} from '@/lib/material-library';
import { createMaterialPhotoRenditions } from '@/lib/material-photo-media';
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
  let extraKeys: string[] = [];
  try {
    assertSameOriginMutationRequest(request);
    const user = await requireUser();
    const actor = materialLibraryActor(user);
    const form = await request.formData();
    const upload = form.get('file');
    const clientMutationId = cleanMaterialText(form.get('clientMutationId'), 80) || null;
    if (clientMutationId && !/^[a-zA-Z0-9_-]{8,80}$/.test(clientMutationId)) return NextResponse.json({ ok: false, error: '上传标识无效' }, { status: 400 });
    if (!(upload instanceof File)) return NextResponse.json({ ok: false, error: '请选择要上传的物料照片' }, { status: 400 });
    if (!upload.size || upload.size > 50 * 1024 * 1024) return NextResponse.json({ ok: false, error: '照片大小应在 50 MB 以内' }, { status: 400 });
    const session = await prisma.materialLibraryCaptureSession.findUnique({ where: { id: params.id } });
    if (!session) return NextResponse.json({ ok: false, error: '拍照录入会话不存在' }, { status: 404 });
    const parent = await prisma.materialLibraryItem.findFirst({ where: { id: session.materialItemId, deletedAt: null }, select: { id: true } });
    if (!parent) return NextResponse.json({ ok: false, error: '物料已移入回收站，不能上传照片' }, { status: 409 });
    const previous = clientMutationId ? await prisma.materialLibraryPhoto.findUnique({ where: { sessionId_clientMutationId: { sessionId: session.id, clientMutationId } } }) : null;
    if (previous) {
      const incomingHash = crypto.createHash('sha256').update(Buffer.from(await upload.arrayBuffer())).digest('hex');
      if (previous.sha256 !== incomingHash || previous.deletedAt) return NextResponse.json({ ok: false, error: '这次上传标识已使用，请重新选择照片' }, { status: 409 });
      return NextResponse.json({ ok: true, photo: serializeMaterialPhoto(previous), reused: true });
    }
    if (session.status !== MaterialLibraryCaptureStatus.ACTIVE) {
      return NextResponse.json({ ok: false, error: '该录入会话已结束，不能继续上传照片' }, { status: 409 });
    }

    const body = Buffer.from(await upload.arrayBuffer());
    const validationError = validateFileContent(upload.name, upload.type, upload.size, body);
    if (validationError) return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(upload.type)) return NextResponse.json({ ok: false, error: '物料照片仅支持 JPG、PNG 或 WEBP 图片' }, { status: 400 });
    const metadata = await sharp(body, { failOn: 'error', limitInputPixels: 60_000_000 }).metadata().catch(() => null);
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
    const mediaPrefix = `${objectKey}.derived`;
    extraKeys = [`${mediaPrefix}/thumb-v1.webp`, `${mediaPrefix}/preview-v1.webp`];
    let media = {};
    try { media = await createMaterialPhotoRenditions(body, mediaPrefix); } catch { /* Durable worker retries the original after successful upload. */ }

    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${materialLibraryItemLockKey(session.materialItemId)}))`;
      const fresh = await tx.materialLibraryCaptureSession.findUnique({ where: { id: session.id } });
      if (!fresh) throw new Error('MATERIAL_SESSION_NOT_FOUND');
      if (clientMutationId) {
        const duplicate = await tx.materialLibraryPhoto.findUnique({ where: { sessionId_clientMutationId: { sessionId: fresh.id, clientMutationId } } });
        if (duplicate) {
          if (duplicate.deletedAt || duplicate.sha256 !== sha256) throw new Error('MATERIAL_UPLOAD_CONFLICT');
          return { photo: duplicate, reused: true };
        }
      }
      const activeItem = await tx.materialLibraryItem.findFirst({ where: { id: fresh.materialItemId, deletedAt: null }, select: { id: true } });
      if (!activeItem) throw new Error('MATERIAL_SESSION_CLOSED');
      if (fresh.status !== MaterialLibraryCaptureStatus.ACTIVE) throw new Error('MATERIAL_SESSION_CLOSED');
      if (form.has('targetSupplierVariantId') && (String(form.get('targetSupplierVariantId') || '') !== (fresh.supplierVariantId || '') || String(form.get('targetBatchNumber') || '') !== (fresh.draftBatchNumber || ''))) throw new Error('MATERIAL_UPLOAD_TARGET_CHANGED');
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
          clientMutationId,
          ...media,
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
      await tx.materialLibraryItem.update({ where: { id: fresh.materialItemId }, data: { updatedAt: new Date() } });
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
      return { photo, reused: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    if (result.reused) await deleteObjectsBestEffort([objectKey!, ...extraKeys]);
    objectKey = null;
    extraKeys = [];
    if (form.get('compact') === '1') return NextResponse.json({ ok: true, photo: serializeMaterialPhoto(result.photo), reused: result.reused }, { status: result.reused ? 200 : 201 });

    const updated = await prisma.materialLibraryCaptureSession.findUnique({ where: { id: session.id }, include: materialLibrarySessionInclude });
    if (!updated) throw new Error('MATERIAL_SESSION_NOT_FOUND');
    return NextResponse.json({ ok: true, session: serializeMaterialSession(updated) }, { status: 201 });
  } catch (error) {
    if (objectKey) await deleteObjectsBestEffort([objectKey, ...extraKeys]);
    if (error instanceof Error) {
      if (error.message === 'MATERIAL_UPLOAD_TARGET_CHANGED') return NextResponse.json({ ok: false, error: '本批供应商或批次已变更，请核对后重新选择照片' }, { status: 409 });
      if (error.message === 'MATERIAL_UPLOAD_CONFLICT') return NextResponse.json({ ok: false, error: '上传标识冲突，请重新选择照片' }, { status: 409 });
      if (error.message === 'MATERIAL_SESSION_NOT_FOUND') return NextResponse.json({ ok: false, error: '拍照录入会话不存在' }, { status: 404 });
      if (error.message === 'MATERIAL_SESSION_CLOSED') return NextResponse.json({ ok: false, error: '该录入会话已结束，不能继续上传照片' }, { status: 409 });
    }
    return materialLibraryRouteError(error, '物料照片上传失败，请检查对象存储');
  }
}
