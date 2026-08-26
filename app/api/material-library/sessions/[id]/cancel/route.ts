import { MaterialLibraryCaptureStatus, MaterialLibraryUploadMode, MaterialLibraryUploadLinkStatus, Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { materialLibraryActor, materialLibraryItemLockKey, positiveVersion } from '@/lib/material-library';
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
        include: { uploadLink: true },
      });
      if (!session) throw new Error('MATERIAL_SESSION_NOT_FOUND');
      if (session.status !== MaterialLibraryCaptureStatus.ACTIVE) throw new Error('MATERIAL_SESSION_CLOSED');
      if (session.version !== expectedVersion) throw new Error('MATERIAL_SESSION_CONFLICT');
      const photos = await tx.materialLibraryPhoto.findMany({
        where: { sessionId: session.id, deletedAt: null },
        select: { id: true, isCover: true },
      });
      await tx.materialLibraryPhoto.updateMany({
        where: { sessionId: session.id, deletedAt: null },
        data: { deletedAt: now, isCover: false },
      });
      if (photos.some(photo => photo.isCover)) {
        const replacement = await tx.materialLibraryPhoto.findFirst({
          where: { materialItemId: session.materialItemId, deletedAt: null, sessionId: { not: session.id } },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: { id: true },
        });
        if (replacement) await tx.materialLibraryPhoto.update({ where: { id: replacement.id }, data: { isCover: true } });
      }
      await tx.materialLibraryCaptureSession.update({
        where: { id: session.id },
        data: { status: MaterialLibraryCaptureStatus.CANCELLED, cancelledAt: now, lastSeenAt: now, version: { increment: 1 } },
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
          action: 'cancel_material_library_capture',
          targetType: 'material_library_capture_session',
          targetId: session.id,
          detail: { materialItemId: session.materialItemId, softDeletedPhotoCount: photos.length, objectsRetained: true },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'MATERIAL_SESSION_NOT_FOUND') return NextResponse.json({ ok: false, error: '拍照录入会话不存在' }, { status: 404 });
      if (error.message === 'MATERIAL_SESSION_CLOSED') return NextResponse.json({ ok: false, error: '该录入会话已结束' }, { status: 409 });
      if (error.message === 'MATERIAL_SESSION_CONFLICT') return NextResponse.json({ ok: false, error: '录入数据已被更新，请刷新后重试' }, { status: 409 });
    }
    return materialLibraryRouteError(error, '拍照录入取消失败');
  }
}
