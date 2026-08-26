import { MaterialLibraryCaptureStatus, MaterialLibraryUploadMode, Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import {
  assertMaterialUploadLinkActive,
  materialLibraryActor,
  materialLibraryItemLockKey,
  materialLibrarySessionInclude,
  materialSessionNo,
  parseMaterialUploadCode,
  serializeMaterialSession,
  verifyMaterialUploadCode,
} from '@/lib/material-library';
import { materialLibraryRouteError } from '@/lib/material-library-http';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { code: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const user = await requireUser();
    const actor = materialLibraryActor(user);
    const rawCode = decodeURIComponent(params.code);
    const parsed = parseMaterialUploadCode(rawCode);
    const now = new Date();
    const target = await prisma.materialLibraryUploadLink.findUnique({
      where: { id: parsed.id },
      select: { materialItemId: true },
    });
    if (!target) throw new Error('MATERIAL_UPLOAD_LINK_NOT_FOUND');

    const sessionId = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${materialLibraryItemLockKey(target.materialItemId)}))`;
      const link = await tx.materialLibraryUploadLink.findUnique({
        where: { id: parsed.id },
        include: { materialItem: { include: { category: true } } },
      });
      if (!link || link.generation !== parsed.generation || !verifyMaterialUploadCode({
        code: rawCode,
        id: link.id,
        generation: link.generation,
        materialItemId: link.materialItemId,
        mode: link.mode,
        tokenHash: link.tokenHash,
      })) {
        throw new Error('MATERIAL_UPLOAD_LINK_NOT_FOUND');
      }
      assertMaterialUploadLinkActive(link, now);
      if (link.materialItem.deletedAt) throw new Error('MATERIAL_ITEM_DELETED');

      const active = await tx.materialLibraryCaptureSession.findFirst({
        where: { materialItemId: link.materialItemId, status: MaterialLibraryCaptureStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
      });
      if (active) {
        if (active.uploadLinkId !== link.id) {
          throw new Error('MATERIAL_ITEM_SESSION_ACTIVE');
        }
        if (active.connectedById && active.connectedById !== actor.id) {
          throw new Error('MATERIAL_SESSION_IN_USE');
        }
        const connected = await tx.materialLibraryCaptureSession.update({
          where: { id: active.id },
          data: {
            connectedById: actor.id,
            connectedByName: actor.name,
            connectedAt: active.connectedAt || now,
            lastSeenAt: now,
          },
          select: { id: true },
        });
        await tx.materialLibraryUploadLink.update({ where: { id: link.id }, data: { lastScannedAt: now } });
        return connected.id;
      }

      if (link.mode === MaterialLibraryUploadMode.TEMPORARY) {
        const used = await tx.materialLibraryCaptureSession.count({ where: { uploadLinkId: link.id } });
        if (used > 0) throw new Error('MATERIAL_TEMPORARY_LINK_USED');
      }

      const item = link.materialItem;
      const created = await tx.materialLibraryCaptureSession.create({
        data: {
          sessionNo: materialSessionNo(now),
          uploadLinkId: link.id,
          materialItemId: item.id,
          categoryId: item.categoryId,
          draftManufacturerModel: item.manufacturerModel,
          draftSpecification: item.specification,
          draftMaterialComposition: item.materialComposition,
          draftSupplierName: item.supplierName,
          draftSupplierPartNumber: item.supplierPartNumber,
          draftBatchNumber: item.batchNumber,
          draftWarningState: item.warningState,
          draftWarningNote: item.warningNote,
          draftNotes: item.notes,
          connectedById: actor.id,
          connectedByName: actor.name,
          connectedAt: now,
          lastSeenAt: now,
        },
        select: { id: true },
      });
      await tx.materialLibraryUploadLink.update({ where: { id: link.id }, data: { lastScannedAt: now } });
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'start_material_library_capture',
          targetType: 'material_library_capture_session',
          targetId: created.id,
          detail: { materialItemId: item.id, uploadLinkId: link.id, mode: link.mode, credentialEmbedded: false },
        },
      });
      return created.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    const session = await prisma.materialLibraryCaptureSession.findUnique({
      where: { id: sessionId },
      include: materialLibrarySessionInclude,
    });
    if (!session) throw new Error('MATERIAL_SESSION_NOT_FOUND');
    return NextResponse.json({ ok: true, session: serializeMaterialSession(session) });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'MATERIAL_UPLOAD_LINK_NOT_FOUND') {
        return NextResponse.json({ ok: false, error: '物料上传二维码不存在或已失效' }, { status: 404 });
      }
      if (error.message === 'MATERIAL_ITEM_DELETED') {
        return NextResponse.json({ ok: false, error: '对应物料档案已在回收站，不能继续录入' }, { status: 410 });
      }
      if (error.message === 'MATERIAL_SESSION_IN_USE') {
        return NextResponse.json({ ok: false, error: '该二维码当前正在另一台手机上录入，请先结束原会话' }, { status: 409 });
      }
      if (error.message === 'MATERIAL_ITEM_SESSION_ACTIVE') {
        return NextResponse.json({ ok: false, error: '该物料正在通过另一张二维码录入，请先归档或取消当前会话' }, { status: 409 });
      }
      if (error.message === 'MATERIAL_TEMPORARY_LINK_USED') {
        return NextResponse.json({ ok: false, error: '临时二维码已完成一次录入，请在电脑端重新生成' }, { status: 410 });
      }
    }
    return materialLibraryRouteError(error, '扫码录入会话创建失败');
  }
}
