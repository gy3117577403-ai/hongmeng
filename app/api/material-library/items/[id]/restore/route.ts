import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import {
  materialLibraryActor,
  materialLibraryItemInclude,
  materialLibraryItemLockKey,
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
    const user = await requireUser();
    const actor = materialLibraryActor(user);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const expectedVersion = positiveVersion(body.expectedVersion);
    const item = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${materialLibraryItemLockKey(params.id)}))`;
      const current = await tx.materialLibraryItem.findUnique({ where: { id: params.id } });
      if (!current) throw new Error('MATERIAL_ITEM_NOT_FOUND');
      if (!current.deletedAt) throw new Error('MATERIAL_ITEM_ACTIVE');
      if (current.version !== expectedVersion) throw new Error('MATERIAL_ITEM_CONFLICT');
      const updated = await tx.materialLibraryItem.updateMany({
        where: { id: current.id, version: expectedVersion, deletedAt: { not: null } },
        data: {
          deletedAt: null,
          deletedReason: null,
          deletedById: null,
          deletedByName: null,
          updatedById: actor.id,
          updatedByName: actor.name,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new Error('MATERIAL_ITEM_CONFLICT');
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'restore_material_library_item',
          targetType: 'material_library_item',
          targetId: current.id,
          detail: { expectedVersion, uploadLinksRemainRevoked: true, photosRetained: true },
        },
      });
      return tx.materialLibraryItem.findUniqueOrThrow({ where: { id: current.id }, include: materialLibraryItemInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return NextResponse.json({ ok: true, item: serializeMaterialItem(item) });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'MATERIAL_ITEM_NOT_FOUND') return NextResponse.json({ ok: false, error: '物料档案不存在' }, { status: 404 });
      if (error.message === 'MATERIAL_ITEM_ACTIVE') return NextResponse.json({ ok: false, error: '物料档案不在回收站' }, { status: 409 });
      if (error.message === 'MATERIAL_ITEM_CONFLICT') return NextResponse.json({ ok: false, error: '物料档案已被其他人修改，请刷新后重试' }, { status: 409 });
    }
    return materialLibraryRouteError(error, '物料档案恢复失败');
  }
}
