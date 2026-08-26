import { MaterialLibraryCaptureStatus, MaterialLibraryUploadLinkStatus, Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import {
  materialLibraryActor,
  materialLibraryItemLockKey,
  materialLibrarySessionInclude,
  serializeMaterialUploadLink,
} from '@/lib/material-library';
import { materialLibraryRouteError } from '@/lib/material-library-http';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function loadLink(id: string) {
  return prisma.materialLibraryUploadLink.findUnique({
    where: { id },
    include: {
      sessions: {
        include: materialLibrarySessionInclude,
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const link = await loadLink(params.id);
    if (!link) return NextResponse.json({ ok: false, error: '物料上传二维码不存在' }, { status: 404 });
    return NextResponse.json({
      ok: true,
      link: serializeMaterialUploadLink({ ...link, latestSession: link.sessions[0] || null }),
    });
  } catch (error) {
    return materialLibraryRouteError(error, '物料上传二维码读取失败');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const user = await requireUser();
    const actor = materialLibraryActor(user);
    const now = new Date();
    const target = await prisma.materialLibraryUploadLink.findUnique({ where: { id: params.id }, select: { materialItemId: true } });
    if (!target) throw new Error('MATERIAL_UPLOAD_LINK_NOT_FOUND');
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${materialLibraryItemLockKey(target.materialItemId)}))`;
      const current = await tx.materialLibraryUploadLink.findUnique({ where: { id: params.id } });
      if (!current) throw new Error('MATERIAL_UPLOAD_LINK_NOT_FOUND');
      if (current.status === MaterialLibraryUploadLinkStatus.REVOKED) return;
      const activeSessions = await tx.materialLibraryCaptureSession.findMany({
        where: { uploadLinkId: current.id, status: MaterialLibraryCaptureStatus.ACTIVE },
        select: { id: true },
      });
      const activeSessionIds = activeSessions.map(session => session.id);
      const draftPhotos = activeSessionIds.length ? await tx.materialLibraryPhoto.findMany({
        where: { sessionId: { in: activeSessionIds }, deletedAt: null },
        select: { id: true, isCover: true },
      }) : [];
      await tx.materialLibraryUploadLink.update({
        where: { id: current.id },
        data: { status: MaterialLibraryUploadLinkStatus.REVOKED, revokedAt: now },
      });
      if (activeSessionIds.length) {
        await tx.materialLibraryPhoto.updateMany({
          where: { sessionId: { in: activeSessionIds }, deletedAt: null },
          data: { deletedAt: now, isCover: false },
        });
        if (draftPhotos.some(photo => photo.isCover)) {
          const replacement = await tx.materialLibraryPhoto.findFirst({
            where: { materialItemId: current.materialItemId, deletedAt: null, sessionId: { notIn: activeSessionIds } },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            select: { id: true },
          });
          if (replacement) await tx.materialLibraryPhoto.update({ where: { id: replacement.id }, data: { isCover: true } });
        }
      }
      await tx.materialLibraryCaptureSession.updateMany({
        where: { uploadLinkId: current.id, status: MaterialLibraryCaptureStatus.ACTIVE },
        data: { status: MaterialLibraryCaptureStatus.CANCELLED, cancelledAt: now, version: { increment: 1 } },
      });
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'revoke_material_library_upload_link',
          targetType: 'material_library_upload_link',
          targetId: current.id,
          detail: {
            mode: current.mode,
            materialItemId: current.materialItemId,
            cancelledSessionCount: activeSessionIds.length,
            softDeletedPhotoCount: draftPhotos.length,
            objectsRetained: true,
          },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'MATERIAL_UPLOAD_LINK_NOT_FOUND') {
      return NextResponse.json({ ok: false, error: '物料上传二维码不存在' }, { status: 404 });
    }
    return materialLibraryRouteError(error, '物料上传二维码撤销失败');
  }
}
