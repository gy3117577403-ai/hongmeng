import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { cleanMaterialText, createMaterialUploadCode, hashMaterialUploadCode, materialLibraryActor, materialLibraryItemLockKey, materialLibrarySessionInclude, materialSessionNo, serializeMaterialSession, MaterialLibraryError } from '@/lib/material-library';
import { materialLibraryRouteError } from '@/lib/material-library-http';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const session = await prisma.materialLibraryCaptureSession.findFirst({ where: { materialItemId: params.id, status: 'ACTIVE', materialItem: { deletedAt: null } }, include: materialLibrarySessionInclude });
    return NextResponse.json({ ok: true, session: session ? serializeMaterialSession(session) : null });
  } catch (error) { return materialLibraryRouteError(error, '本次来料记录读取失败'); }
}
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const user = await requireUser(), actor = materialLibraryActor(user), body = await request.json();
    const supplierVariantId = cleanMaterialText(body.supplierVariantId, 80), batchNumber = cleanMaterialText(body.batchNumber, 120);
    const sessionId = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${materialLibraryItemLockKey(params.id)}))`;
      const item = await tx.materialLibraryItem.findFirst({ where: { id: params.id, deletedAt: null } });
      if (!item) throw new MaterialLibraryError('物料不存在或已删除', 404);
      const current = await tx.materialLibraryCaptureSession.findFirst({ where: { materialItemId: item.id, status: 'ACTIVE' } });
      if (current) {
        if (current.connectedById && current.connectedById !== actor.id && user.laborRole !== 'ADMIN') throw new MaterialLibraryError('本物料正在由其他人录入，请先完成本次来料记录', 409);
        if (current.supplierVariantId !== supplierVariantId || current.draftBatchNumber !== batchNumber) throw new MaterialLibraryError('已有未归档来料记录，请先完成该记录后再上传其他批次', 409);
        return current.id;
      }
      const variant = supplierVariantId ? await tx.materialLibrarySupplierVariant.findFirst({ where: { id: supplierVariantId, materialItemId: item.id, deletedAt: null } }) : null;
      if (supplierVariantId && !variant) throw new MaterialLibraryError('供应商型号已变化，请重新选择', 409);
      let link = await tx.materialLibraryUploadLink.findFirst({ where: { materialItemId: item.id, mode: 'PERMANENT', status: 'ACTIVE' } });
      if (!link) {
        const id = crypto.randomUUID(), generation = 1;
        const code = createMaterialUploadCode({ id, generation, materialItemId: item.id, mode: 'PERMANENT' });
        link = await tx.materialLibraryUploadLink.create({ data: { id, materialItemId: item.id, mode: 'PERMANENT', generation, tokenHash: hashMaterialUploadCode(code), createdById: actor.id, createdByName: actor.name } });
      }
      const session = await tx.materialLibraryCaptureSession.create({ data: {
        sessionNo: materialSessionNo(), materialItemId: item.id, categoryId: item.categoryId, uploadLinkId: link.id,
        supplierVariantId, draftBatchNumber: batchNumber,
        draftSupplierName: variant?.supplierName ?? item.supplierName, draftSupplierPartNumber: variant?.supplierPartNumber ?? item.supplierPartNumber,
        draftManufacturerModel: variant?.manufacturerModel ?? item.manufacturerModel, draftSpecification: variant?.specification ?? item.specification,
        draftMaterialComposition: variant?.materialComposition ?? item.materialComposition,
        connectedById: actor.id, connectedByName: actor.name, connectedAt: new Date(), lastSeenAt: new Date(),
      } });
      await tx.operationLog.create({ data: { userId: actor.id, action: 'start_material_library_capture', targetType: 'material_library_capture_session', targetId: session.id, detail: { materialItemId: item.id, supplierVariantId, batchNumber, source: 'DESKTOP_ALBUM' } } });
      return session.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    const session = await prisma.materialLibraryCaptureSession.findUniqueOrThrow({ where: { id: sessionId }, include: materialLibrarySessionInclude });
    return NextResponse.json({ ok: true, session: serializeMaterialSession(session) });
  } catch (error) { return materialLibraryRouteError(error, '照片上传记录创建失败'); }
}
