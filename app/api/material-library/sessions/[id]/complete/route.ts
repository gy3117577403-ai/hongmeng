import { MaterialLibraryCaptureStatus, MaterialLibraryUploadMode, MaterialLibraryUploadLinkStatus, Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import {
  materialLibraryActor,
  materialLibraryItemLockKey,
  materialLibrarySessionInclude,
  positiveVersion,
  serializeMaterialSession,
} from '@/lib/material-library';
import { materialLibraryRouteError } from '@/lib/material-library-http';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const actor = materialLibraryActor(await requireUser());
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const expectedVersion = positiveVersion(body.expectedVersion);
    const now = new Date();
    const target = await prisma.materialLibraryCaptureSession.findUnique({ where: { id: params.id }, select: { materialItemId: true } });
    if (!target) throw new Error('MATERIAL_SESSION_NOT_FOUND');

    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${materialLibraryItemLockKey(target.materialItemId)}))`;
      const session = await tx.materialLibraryCaptureSession.findUnique({
        where: { id: params.id },
        include: { uploadLink: true, materialItem: true },
      });
      if (!session) throw new Error('MATERIAL_SESSION_NOT_FOUND');
      if (session.status !== MaterialLibraryCaptureStatus.ACTIVE) throw new Error('MATERIAL_SESSION_CLOSED');
      if (session.version !== expectedVersion) throw new Error('MATERIAL_SESSION_CONFLICT');
      if (session.materialItem.deletedAt) throw new Error('MATERIAL_ITEM_DELETED');
      const category = await tx.materialLibraryCategory.findFirst({ where: { id: session.categoryId, deletedAt: null } });
      if (!category) throw new Error('MATERIAL_CATEGORY_NOT_FOUND');
      const photoCount = await tx.materialLibraryPhoto.count({ where: { sessionId: session.id, deletedAt: null } });
      if (photoCount < 1) throw new Error('MATERIAL_SESSION_PHOTO_REQUIRED');

      await tx.materialLibraryItem.update({
        where: { id: session.materialItemId },
        data: {
          categoryId: session.categoryId,
          manufacturerModel: session.draftManufacturerModel,
          specification: session.draftSpecification,
          materialComposition: session.draftMaterialComposition,
          supplierName: session.draftSupplierName,
          supplierPartNumber: session.draftSupplierPartNumber,
          batchNumber: session.draftBatchNumber,
          warningState: session.draftWarningState,
          warningNote: session.draftWarningNote,
          notes: session.draftNotes,
          lastCapturedAt: now,
          updatedById: actor.id,
          updatedByName: actor.name,
          version: { increment: 1 },
        },
      });
      await tx.materialLibraryCaptureSession.update({
        where: { id: session.id },
        data: { status: MaterialLibraryCaptureStatus.COMPLETED, completedAt: now, lastSeenAt: now, version: { increment: 1 } },
      });
      if (session.uploadLink.mode === MaterialLibraryUploadMode.TEMPORARY) {
        await tx.materialLibraryUploadLink.update({
          where: { id: session.uploadLinkId },
          data: { status: MaterialLibraryUploadLinkStatus.REVOKED, revokedAt: now },
        });
      }
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'complete_material_library_capture',
          targetType: 'material_library_capture_session',
          targetId: session.id,
          detail: { materialItemId: session.materialItemId, photoCount, uploadMode: session.uploadLink.mode, synchronizedToArchive: true },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    const session = await prisma.materialLibraryCaptureSession.findUnique({ where: { id: params.id }, include: materialLibrarySessionInclude });
    if (!session) throw new Error('MATERIAL_SESSION_NOT_FOUND');
    return NextResponse.json({ ok: true, session: serializeMaterialSession(session) });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'MATERIAL_SESSION_NOT_FOUND') return NextResponse.json({ ok: false, error: '拍照录入会话不存在' }, { status: 404 });
      if (error.message === 'MATERIAL_SESSION_CLOSED') return NextResponse.json({ ok: false, error: '该录入会话已结束' }, { status: 409 });
      if (error.message === 'MATERIAL_SESSION_CONFLICT') return NextResponse.json({ ok: false, error: '录入数据已被更新，请刷新后再归档' }, { status: 409 });
      if (error.message === 'MATERIAL_ITEM_DELETED') return NextResponse.json({ ok: false, error: '物料档案已在回收站，不能归档' }, { status: 409 });
      if (error.message === 'MATERIAL_CATEGORY_NOT_FOUND') return NextResponse.json({ ok: false, error: '所选物料分类已停用，请重新选择' }, { status: 409 });
      if (error.message === 'MATERIAL_SESSION_PHOTO_REQUIRED') return NextResponse.json({ ok: false, error: '至少拍摄并上传 1 张物料照片后才能归档' }, { status: 400 });
    }
    return materialLibraryRouteError(error, '拍照录入归档失败');
  }
}
