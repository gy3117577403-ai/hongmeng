import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import {
  materialLibraryActor,
  materialLibraryItemInclude,
  materialLibraryItemLockKey,
  materialSupplierVariantData,
  positiveVersion,
  serializeMaterialItem,
} from '@/lib/material-library';
import { materialLibraryRouteError } from '@/lib/material-library-http';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const actor = materialLibraryActor(await requireUser());
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const expectedVersion = positiveVersion(body.expectedVersion);
    const variantData = materialSupplierVariantData(body);
    const target = await prisma.materialLibrarySupplierVariant.findUnique({ where: { id: params.id }, select: { materialItemId: true } });
    if (!target) throw new Error('MATERIAL_VARIANT_NOT_FOUND');

    const item = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${materialLibraryItemLockKey(target.materialItemId)}))`;
      const current = await tx.materialLibrarySupplierVariant.findUnique({ where: { id: params.id } });
      if (!current || current.deletedAt) throw new Error('MATERIAL_VARIANT_NOT_FOUND');
      if (current.version !== expectedVersion) throw new Error('MATERIAL_VARIANT_CONFLICT');
      const makePrimary = body.isPrimary === true || current.isPrimary;
      if (makePrimary) {
        await tx.materialLibrarySupplierVariant.updateMany({
          where: { materialItemId: current.materialItemId, id: { not: current.id }, isPrimary: true, deletedAt: null },
          data: { isPrimary: false, updatedById: actor.id, updatedByName: actor.name, version: { increment: 1 } },
        });
      }
      await tx.materialLibrarySupplierVariant.update({
        where: { id: current.id },
        data: { ...variantData, isPrimary: makePrimary, updatedById: actor.id, updatedByName: actor.name, version: { increment: 1 } },
      });
      await tx.materialLibraryItem.update({
        where: { id: current.materialItemId },
        data: {
          ...(makePrimary ? variantData : {}),
          updatedById: actor.id,
          updatedByName: actor.name,
          version: { increment: 1 },
        },
      });
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'update_material_library_supplier_variant',
          targetType: 'material_library_supplier_variant',
          targetId: current.id,
          detail: { materialItemId: current.materialItemId, isPrimary: makePrimary },
        },
      });
      return tx.materialLibraryItem.findUniqueOrThrow({ where: { id: current.materialItemId }, include: materialLibraryItemInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    return NextResponse.json({ ok: true, item: serializeMaterialItem(item) });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'MATERIAL_VARIANT_NOT_FOUND') return NextResponse.json({ ok: false, error: '供应商型号不存在或已停用' }, { status: 404 });
      if (error.message === 'MATERIAL_VARIANT_CONFLICT') return NextResponse.json({ ok: false, error: '供应商型号已更新，请刷新后重试' }, { status: 409 });
    }
    return materialLibraryRouteError(error, '供应商型号更新失败');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const actor = materialLibraryActor(await requireUser());
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const expectedVersion = positiveVersion(body.expectedVersion);
    const target = await prisma.materialLibrarySupplierVariant.findUnique({ where: { id: params.id }, select: { materialItemId: true } });
    if (!target) throw new Error('MATERIAL_VARIANT_NOT_FOUND');
    const now = new Date();
    const item = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${materialLibraryItemLockKey(target.materialItemId)}))`;
      const current = await tx.materialLibrarySupplierVariant.findUnique({ where: { id: params.id } });
      if (!current || current.deletedAt) throw new Error('MATERIAL_VARIANT_NOT_FOUND');
      if (current.version !== expectedVersion) throw new Error('MATERIAL_VARIANT_CONFLICT');
      await tx.materialLibrarySupplierVariant.update({
        where: { id: current.id },
        data: { deletedAt: now, isPrimary: false, updatedById: actor.id, updatedByName: actor.name, version: { increment: 1 } },
      });
      if (current.isPrimary) {
        const replacement = await tx.materialLibrarySupplierVariant.findFirst({
          where: { materialItemId: current.materialItemId, id: { not: current.id }, deletedAt: null },
          orderBy: { updatedAt: 'desc' },
        });
        if (replacement) {
          await tx.materialLibrarySupplierVariant.update({ where: { id: replacement.id }, data: { isPrimary: true, version: { increment: 1 } } });
          await tx.materialLibraryItem.update({
            where: { id: current.materialItemId },
            data: {
              supplierName: replacement.supplierName,
              manufacturerModel: replacement.manufacturerModel,
              supplierPartNumber: replacement.supplierPartNumber,
              specification: replacement.specification,
              materialComposition: replacement.materialComposition,
              updatedById: actor.id,
              updatedByName: actor.name,
              version: { increment: 1 },
            },
          });
        } else {
          await tx.materialLibraryItem.update({
            where: { id: current.materialItemId },
            data: {
              supplierName: null,
              manufacturerModel: null,
              supplierPartNumber: null,
              specification: null,
              materialComposition: null,
              updatedById: actor.id,
              updatedByName: actor.name,
              version: { increment: 1 },
            },
          });
        }
      } else {
        await tx.materialLibraryItem.update({ where: { id: current.materialItemId }, data: { version: { increment: 1 } } });
      }
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'delete_material_library_supplier_variant',
          targetType: 'material_library_supplier_variant',
          targetId: current.id,
          detail: { materialItemId: current.materialItemId, softDelete: true },
        },
      });
      return tx.materialLibraryItem.findUniqueOrThrow({ where: { id: current.materialItemId }, include: materialLibraryItemInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return NextResponse.json({ ok: true, item: serializeMaterialItem(item) });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'MATERIAL_VARIANT_NOT_FOUND') return NextResponse.json({ ok: false, error: '供应商型号不存在或已停用' }, { status: 404 });
      if (error.message === 'MATERIAL_VARIANT_CONFLICT') return NextResponse.json({ ok: false, error: '供应商型号已更新，请刷新后重试' }, { status: 409 });
    }
    return materialLibraryRouteError(error, '供应商型号删除失败');
  }
}
