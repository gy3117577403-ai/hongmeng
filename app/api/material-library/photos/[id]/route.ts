import { MaterialLibraryCaptureStatus, Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
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
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function rotationValue(value: unknown): number | undefined {
  const rotation = Number(value);
  return rotation === 0 || rotation === 90 || rotation === 180 || rotation === 270 ? rotation : undefined;
}

async function serializedSession(sessionId: string) {
  const session = await prisma.materialLibraryCaptureSession.findUnique({
    where: { id: sessionId },
    include: materialLibrarySessionInclude,
  });
  return session ? serializeMaterialSession(session) : null;
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const actor = materialLibraryActor(await requireUser());
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const rotation = body.rotation === undefined ? undefined : rotationValue(body.rotation);
    if (body.rotation !== undefined && rotation === undefined) {
      return NextResponse.json({ ok: false, error: '照片旋转角度无效' }, { status: 400 });
    }
    const isCover = body.isCover === true;

    const sessionId = await prisma.$transaction(async tx => {
      let current = await tx.materialLibraryPhoto.findFirst({
        where: { id: params.id, deletedAt: null },
        include: { session: { select: { status: true } } },
      });
      if (!current) throw new Error('MATERIAL_PHOTO_NOT_FOUND');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${materialLibraryItemLockKey(current.materialItemId)}))`;
      current = await tx.materialLibraryPhoto.findFirst({
        where: { id: params.id, deletedAt: null },
        include: { session: { select: { status: true } } },
      });
      if (!current) throw new Error('MATERIAL_PHOTO_NOT_FOUND');
      if (isCover) {
        await tx.materialLibraryPhoto.updateMany({
          where: { materialItemId: current.materialItemId, deletedAt: null, id: { not: current.id } },
          data: { isCover: false },
        });
      }
      await tx.materialLibraryPhoto.update({
        where: { id: current.id },
        data: {
          ...(rotation === undefined ? {} : { rotation }),
          ...(body.caption === undefined ? {} : { caption: cleanMaterialText(body.caption, 500) }),
          ...(body.isCover === undefined ? {} : { isCover }),
        },
      });
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'update_material_library_photo',
          targetType: 'material_library_photo',
          targetId: current.id,
          detail: { sessionId: current.sessionId, rotation, isCover: body.isCover === undefined ? null : isCover },
        },
      });
      return current.sessionId;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return NextResponse.json({ ok: true, session: await serializedSession(sessionId) });
  } catch (error) {
    if (error instanceof Error && error.message === 'MATERIAL_PHOTO_NOT_FOUND') {
      return NextResponse.json({ ok: false, error: '物料照片不存在或已删除' }, { status: 404 });
    }
    return materialLibraryRouteError(error, '物料照片更新失败');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const user = await requireUser();
    const actor = materialLibraryActor(user);
    const canDeleteArchived = user.laborRole === 'ADMIN' || user.access.capabilities.includes('QUALITY:DELETE');
    const sessionId = await prisma.$transaction(async tx => {
      let current = await tx.materialLibraryPhoto.findFirst({
        where: { id: params.id, deletedAt: null },
        include: { session: { select: { status: true } } },
      });
      if (!current) throw new Error('MATERIAL_PHOTO_NOT_FOUND');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${materialLibraryItemLockKey(current.materialItemId)}))`;
      current = await tx.materialLibraryPhoto.findFirst({
        where: { id: params.id, deletedAt: null },
        include: { session: { select: { status: true } } },
      });
      if (!current) throw new Error('MATERIAL_PHOTO_NOT_FOUND');
      if (current.session.status !== MaterialLibraryCaptureStatus.ACTIVE && !canDeleteArchived) {
        throw new Error('MATERIAL_PHOTO_ARCHIVED_DELETE_FORBIDDEN');
      }
      await tx.materialLibraryPhoto.update({ where: { id: current.id }, data: { deletedAt: new Date(), isCover: false } });
      if (current.isCover) {
        const replacement = await tx.materialLibraryPhoto.findFirst({
          where: { materialItemId: current.materialItemId, deletedAt: null, id: { not: current.id } },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: { id: true },
        });
        if (replacement) await tx.materialLibraryPhoto.update({ where: { id: replacement.id }, data: { isCover: true } });
      }
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'delete_material_library_photo',
          targetType: 'material_library_photo',
          targetId: current.id,
          detail: { sessionId: current.sessionId, materialItemId: current.materialItemId, softDelete: true, objectRetained: true },
        },
      });
      return current.sessionId;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return NextResponse.json({ ok: true, session: await serializedSession(sessionId) });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'MATERIAL_PHOTO_NOT_FOUND') return NextResponse.json({ ok: false, error: '物料照片不存在或已删除' }, { status: 404 });
      if (error.message === 'MATERIAL_PHOTO_ARCHIVED_DELETE_FORBIDDEN') {
        return NextResponse.json({ ok: false, error: '已归档照片仅管理员可删除；品质人员可在录入完成前移除误拍照片' }, { status: 403 });
      }
    }
    return materialLibraryRouteError(error, '物料照片删除失败');
  }
}
