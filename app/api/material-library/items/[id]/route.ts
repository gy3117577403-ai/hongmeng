import { MaterialLibraryCaptureStatus, MaterialLibraryUploadLinkStatus, Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import {
  cleanMaterialText,
  materialItemUpdateData,
  materialLibraryActor,
  materialLibraryItemLockKey,
  materialLibraryItemInclude,
  positiveVersion,
  requiredMaterialText,
  serializeMaterialItem,
} from '@/lib/material-library';
import { materialLibraryRouteError } from '@/lib/material-library-http';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const item = await prisma.materialLibraryItem.findUnique({ where: { id: params.id }, include: materialLibraryItemInclude });
    if (!item) return NextResponse.json({ ok: false, error: '物料档案不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, item: serializeMaterialItem(item) });
  } catch (error) {
    return materialLibraryRouteError(error, '物料档案读取失败');
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const user = await requireUser();
    const actor = materialLibraryActor(user);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const expectedVersion = positiveVersion(body.expectedVersion);
    const data = materialItemUpdateData(body);
    const { code: _requestedCode, ...mutableData } = data;
    const item = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${materialLibraryItemLockKey(params.id)}))`;
      const current = await tx.materialLibraryItem.findUnique({ where: { id: params.id } });
      if (!current) throw new Error('MATERIAL_ITEM_NOT_FOUND');
      if (current.deletedAt) throw new Error('MATERIAL_ITEM_DELETED');
      if (current.version !== expectedVersion) throw new Error('MATERIAL_ITEM_CONFLICT');
      const category = await tx.materialLibraryCategory.findFirst({ where: { id: data.categoryId, deletedAt: null } });
      if (!category) throw new Error('MATERIAL_CATEGORY_NOT_FOUND');
      const updated = await tx.materialLibraryItem.updateMany({
        where: { id: current.id, version: expectedVersion, deletedAt: null },
        data: { ...mutableData, updatedById: actor.id, updatedByName: actor.name, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new Error('MATERIAL_ITEM_CONFLICT');
      const primaryVariant = await tx.materialLibrarySupplierVariant.findFirst({
        where: { materialItemId: current.id, isPrimary: true, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
      });
      const variantData = {
        supplierName: data.supplierName,
        manufacturerModel: data.manufacturerModel,
        supplierPartNumber: data.supplierPartNumber,
        specification: data.specification,
        materialComposition: data.materialComposition,
        updatedById: actor.id,
        updatedByName: actor.name,
      };
      const hasVariantData = Boolean(
        data.supplierName
        || data.manufacturerModel
        || data.supplierPartNumber
        || data.specification
        || data.materialComposition,
      );
      if (primaryVariant) {
        await tx.materialLibrarySupplierVariant.update({
          where: { id: primaryVariant.id },
          data: { ...variantData, version: { increment: 1 } },
        });
      } else if (hasVariantData) {
        await tx.materialLibrarySupplierVariant.create({
          data: {
            materialItemId: current.id,
            ...variantData,
            isPrimary: true,
            createdById: actor.id,
            createdByName: actor.name,
          },
        });
      }
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'update_material_library_item',
          targetType: 'material_library_item',
          targetId: current.id,
          detail: { expectedVersion, code: current.code, immutableCode: true, categoryId: data.categoryId },
        },
      });
      return tx.materialLibraryItem.findUniqueOrThrow({ where: { id: current.id }, include: materialLibraryItemInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return NextResponse.json({ ok: true, item: serializeMaterialItem(item) });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'MATERIAL_ITEM_NOT_FOUND') return NextResponse.json({ ok: false, error: '物料档案不存在' }, { status: 404 });
      if (error.message === 'MATERIAL_ITEM_DELETED') return NextResponse.json({ ok: false, error: '回收站中的物料不能编辑，请先恢复' }, { status: 409 });
      if (error.message === 'MATERIAL_ITEM_CONFLICT') return NextResponse.json({ ok: false, error: '物料档案已被其他人修改，请刷新后重试' }, { status: 409 });
      if (error.message === 'MATERIAL_CATEGORY_NOT_FOUND') return NextResponse.json({ ok: false, error: '所选物料分类不存在' }, { status: 404 });
    }
    return materialLibraryRouteError(error, '物料档案更新失败');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const user = await requireUser();
    const actor = materialLibraryActor(user);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const expectedVersion = positiveVersion(body.expectedVersion);
    const reason = requiredMaterialText(body.reason, '移入回收站原因', 300);
    const now = new Date();
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${materialLibraryItemLockKey(params.id)}))`;
      const current = await tx.materialLibraryItem.findUnique({ where: { id: params.id } });
      if (!current) throw new Error('MATERIAL_ITEM_NOT_FOUND');
      if (current.deletedAt) throw new Error('MATERIAL_ITEM_DELETED');
      if (current.version !== expectedVersion) throw new Error('MATERIAL_ITEM_CONFLICT');
      const updated = await tx.materialLibraryItem.updateMany({
        where: { id: current.id, version: expectedVersion, deletedAt: null },
        data: {
          deletedAt: now,
          deletedReason: reason,
          deletedById: actor.id,
          deletedByName: actor.name,
          updatedById: actor.id,
          updatedByName: actor.name,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new Error('MATERIAL_ITEM_CONFLICT');
      await tx.materialLibraryUploadLink.updateMany({
        where: { materialItemId: current.id, status: MaterialLibraryUploadLinkStatus.ACTIVE },
        data: { status: MaterialLibraryUploadLinkStatus.REVOKED, revokedAt: now },
      });
      await tx.materialLibraryCaptureSession.updateMany({
        where: { materialItemId: current.id, status: MaterialLibraryCaptureStatus.ACTIVE },
        data: { status: MaterialLibraryCaptureStatus.CANCELLED, cancelledAt: now, version: { increment: 1 } },
      });
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'delete_material_library_item',
          targetType: 'material_library_item',
          targetId: current.id,
          detail: {
            reason: cleanMaterialText(reason, 300),
            softDelete: true,
            photosRetainedInObjectStorage: true,
            activeUploadLinksRevoked: true,
          },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'MATERIAL_ITEM_NOT_FOUND') return NextResponse.json({ ok: false, error: '物料档案不存在' }, { status: 404 });
      if (error.message === 'MATERIAL_ITEM_DELETED') return NextResponse.json({ ok: false, error: '物料档案已在回收站' }, { status: 409 });
      if (error.message === 'MATERIAL_ITEM_CONFLICT') return NextResponse.json({ ok: false, error: '物料档案已被其他人修改，请刷新后重试' }, { status: 409 });
    }
    return materialLibraryRouteError(error, '物料档案移入回收站失败');
  }
}
