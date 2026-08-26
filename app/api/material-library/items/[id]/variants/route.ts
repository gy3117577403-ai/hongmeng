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

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const actor = materialLibraryActor(await requireUser());
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const expectedVersion = positiveVersion(body.expectedVersion);
    const variantData = materialSupplierVariantData(body);
    if (!variantData.supplierName && !variantData.manufacturerModel && !variantData.supplierPartNumber) {
      return NextResponse.json({ ok: false, error: '供应商、厂家型号或供应商料号至少填写一项' }, { status: 400 });
    }

    const item = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${materialLibraryItemLockKey(params.id)}))`;
      const current = await tx.materialLibraryItem.findUnique({ where: { id: params.id } });
      if (!current) throw new Error('MATERIAL_ITEM_NOT_FOUND');
      if (current.deletedAt) throw new Error('MATERIAL_ITEM_DELETED');
      if (current.version !== expectedVersion) throw new Error('MATERIAL_ITEM_CONFLICT');
      const activeCount = await tx.materialLibrarySupplierVariant.count({ where: { materialItemId: current.id, deletedAt: null } });
      const makePrimary = body.isPrimary === true || activeCount === 0;
      if (makePrimary) {
        await tx.materialLibrarySupplierVariant.updateMany({
          where: { materialItemId: current.id, isPrimary: true, deletedAt: null },
          data: { isPrimary: false, updatedById: actor.id, updatedByName: actor.name, version: { increment: 1 } },
        });
      }
      const variant = await tx.materialLibrarySupplierVariant.create({
        data: {
          materialItemId: current.id,
          ...variantData,
          isPrimary: makePrimary,
          createdById: actor.id,
          createdByName: actor.name,
          updatedById: actor.id,
          updatedByName: actor.name,
        },
      });
      await tx.materialLibraryItem.update({
        where: { id: current.id },
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
          action: 'create_material_library_supplier_variant',
          targetType: 'material_library_supplier_variant',
          targetId: variant.id,
          detail: { materialItemId: current.id, isPrimary: makePrimary },
        },
      });
      return tx.materialLibraryItem.findUniqueOrThrow({ where: { id: current.id }, include: materialLibraryItemInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    return NextResponse.json({ ok: true, item: serializeMaterialItem(item) }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'MATERIAL_ITEM_NOT_FOUND') return NextResponse.json({ ok: false, error: '物料档案不存在' }, { status: 404 });
      if (error.message === 'MATERIAL_ITEM_DELETED') return NextResponse.json({ ok: false, error: '回收站中的物料不能新增供应商型号' }, { status: 409 });
      if (error.message === 'MATERIAL_ITEM_CONFLICT') return NextResponse.json({ ok: false, error: '物料档案已更新，请刷新后重试' }, { status: 409 });
    }
    return materialLibraryRouteError(error, '供应商型号新增失败');
  }
}
