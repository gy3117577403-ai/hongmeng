import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import {
  materialLibraryActor,
  positiveVersion,
  requiredMaterialText,
  serializeMaterialCategory,
} from '@/lib/material-library';
import { materialLibraryRouteError } from '@/lib/material-library-http';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const user = await requireUser();
    const actor = materialLibraryActor(user);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const expectedVersion = positiveVersion(body.expectedVersion, '分类版本');
    const name = requiredMaterialText(body.name, '分类名称', 80);
    const category = await prisma.$transaction(async tx => {
      const current = await tx.materialLibraryCategory.findFirst({ where: { id: params.id, deletedAt: null } });
      if (!current) throw new Error('MATERIAL_CATEGORY_NOT_FOUND');
      if (current.version !== expectedVersion) throw new Error('MATERIAL_CATEGORY_CONFLICT');
      const updated = await tx.materialLibraryCategory.updateMany({
        where: { id: current.id, version: expectedVersion, deletedAt: null },
        data: { name, updatedById: actor.id, updatedByName: actor.name, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new Error('MATERIAL_CATEGORY_CONFLICT');
      await tx.operationLog.create({ data: { userId: actor.id, action: 'update_material_library_category', targetType: 'material_library_category', targetId: current.id, detail: { name, expectedVersion } } });
      return tx.materialLibraryCategory.findUniqueOrThrow({ where: { id: current.id }, include: { _count: { select: { items: { where: { deletedAt: null } } } } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true, category: serializeMaterialCategory(category) });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'MATERIAL_CATEGORY_NOT_FOUND') return NextResponse.json({ ok: false, error: '物料分类不存在' }, { status: 404 });
      if (error.message === 'MATERIAL_CATEGORY_CONFLICT') return NextResponse.json({ ok: false, error: '物料分类已被其他人修改，请刷新后重试' }, { status: 409 });
    }
    return materialLibraryRouteError(error, '物料分类更新失败');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const user = await requireUser();
    const actor = materialLibraryActor(user);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const expectedVersion = positiveVersion(body.expectedVersion, '分类版本');
    await prisma.$transaction(async tx => {
      const current = await tx.materialLibraryCategory.findFirst({ where: { id: params.id, deletedAt: null }, include: { _count: { select: { items: true } } } });
      if (!current) throw new Error('MATERIAL_CATEGORY_NOT_FOUND');
      if (current.version !== expectedVersion) throw new Error('MATERIAL_CATEGORY_CONFLICT');
      if (current.isSystem) throw new Error('MATERIAL_CATEGORY_SYSTEM');
      if (current._count.items > 0) throw new Error('MATERIAL_CATEGORY_IN_USE');
      const updated = await tx.materialLibraryCategory.updateMany({
        where: { id: current.id, version: expectedVersion, deletedAt: null },
        data: { deletedAt: new Date(), updatedById: actor.id, updatedByName: actor.name, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new Error('MATERIAL_CATEGORY_CONFLICT');
      await tx.operationLog.create({ data: { userId: actor.id, action: 'delete_material_library_category', targetType: 'material_library_category', targetId: current.id, detail: { softDelete: true } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'MATERIAL_CATEGORY_NOT_FOUND') return NextResponse.json({ ok: false, error: '物料分类不存在' }, { status: 404 });
      if (error.message === 'MATERIAL_CATEGORY_CONFLICT') return NextResponse.json({ ok: false, error: '物料分类已被其他人修改，请刷新后重试' }, { status: 409 });
      if (error.message === 'MATERIAL_CATEGORY_SYSTEM') return NextResponse.json({ ok: false, error: '端子、连接器和辅料为系统分类，不能删除' }, { status: 409 });
      if (error.message === 'MATERIAL_CATEGORY_IN_USE') return NextResponse.json({ ok: false, error: '分类下仍有物料（含回收站档案），请先移动物料后再删除' }, { status: 409 });
    }
    return materialLibraryRouteError(error, '物料分类删除失败');
  }
}
