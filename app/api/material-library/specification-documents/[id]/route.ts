import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import {
  materialLibraryActor,
  materialLibraryItemInclude,
  materialLibraryItemLockKey,
  serializeMaterialItem,
} from '@/lib/material-library';
import { materialLibraryRouteError } from '@/lib/material-library-http';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const actor = materialLibraryActor(await requireUser());
    const target = await prisma.materialLibrarySpecificationDocument.findUnique({
      where: { id: params.id },
      select: { supplierVariantId: true, supplierVariant: { select: { materialItemId: true } } },
    });
    if (!target) throw new Error('MATERIAL_DOCUMENT_NOT_FOUND');
    const item = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${materialLibraryItemLockKey(target.supplierVariant.materialItemId)}))`;
      const document = await tx.materialLibrarySpecificationDocument.findFirst({ where: { id: params.id, deletedAt: null } });
      if (!document) throw new Error('MATERIAL_DOCUMENT_NOT_FOUND');
      const now = new Date();
      await tx.materialLibrarySpecificationDocument.update({ where: { id: document.id }, data: { deletedAt: now, isCurrent: false } });
      if (document.isCurrent) {
        const replacement = await tx.materialLibrarySpecificationDocument.findFirst({
          where: { supplierVariantId: document.supplierVariantId, id: { not: document.id }, deletedAt: null },
          orderBy: { revision: 'desc' },
        });
        if (replacement) await tx.materialLibrarySpecificationDocument.update({ where: { id: replacement.id }, data: { isCurrent: true } });
      }
      await tx.materialLibrarySupplierVariant.update({
        where: { id: document.supplierVariantId },
        data: { updatedById: actor.id, updatedByName: actor.name, version: { increment: 1 } },
      });
      await tx.materialLibraryItem.update({
        where: { id: target.supplierVariant.materialItemId },
        data: { updatedById: actor.id, updatedByName: actor.name, version: { increment: 1 } },
      });
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'delete_material_library_specification',
          targetType: 'material_library_specification_document',
          targetId: document.id,
          detail: { materialItemId: target.supplierVariant.materialItemId, supplierVariantId: document.supplierVariantId, softDelete: true, objectRetained: true },
        },
      });
      return tx.materialLibraryItem.findUniqueOrThrow({ where: { id: target.supplierVariant.materialItemId }, include: materialLibraryItemInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return NextResponse.json({ ok: true, item: serializeMaterialItem(item) });
  } catch (error) {
    if (error instanceof Error && error.message === 'MATERIAL_DOCUMENT_NOT_FOUND') {
      return NextResponse.json({ ok: false, error: '供应商规格书不存在或已删除' }, { status: 404 });
    }
    return materialLibraryRouteError(error, '供应商规格书删除失败');
  }
}
