import { MaterialLibraryWarningState, Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import {
  materialItemCreateData,
  materialLibraryActor,
  materialLibraryItemInclude,
  nextMaterialLibraryCode,
  serializeMaterialItem,
} from '@/lib/material-library';
import { materialLibraryRouteError } from '@/lib/material-library-http';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function limitedNumber(value: string | null, fallback = 240): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 400) : fallback;
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const search = request.nextUrl.searchParams;
    const keyword = String(search.get('keyword') || '').trim().slice(0, 160);
    const categoryId = String(search.get('categoryId') || '').trim();
    const warning = String(search.get('warning') || '').trim();
    const state = String(search.get('state') || 'active').trim();
    const where: Prisma.MaterialLibraryItemWhereInput = {
      ...(state === 'deleted' ? { deletedAt: { not: null } } : state === 'all' ? {} : { deletedAt: null }),
      ...(categoryId ? { categoryId } : {}),
      ...(warning === 'ATTENTION' || warning === 'DEFECT' || warning === 'NONE'
        ? { warningState: warning as MaterialLibraryWarningState }
        : warning === 'ANY' ? { warningState: { not: MaterialLibraryWarningState.NONE } } : {}),
      ...(keyword ? {
        OR: [
          { code: { contains: keyword, mode: 'insensitive' } },
          { name: { contains: keyword, mode: 'insensitive' } },
          { manufacturerModel: { contains: keyword, mode: 'insensitive' } },
          { specification: { contains: keyword, mode: 'insensitive' } },
          { supplierName: { contains: keyword, mode: 'insensitive' } },
          { supplierPartNumber: { contains: keyword, mode: 'insensitive' } },
          { batchNumber: { contains: keyword, mode: 'insensitive' } },
          { supplierVariants: { some: { deletedAt: null, OR: [
            { supplierName: { contains: keyword, mode: 'insensitive' } },
            { manufacturerModel: { contains: keyword, mode: 'insensitive' } },
            { supplierPartNumber: { contains: keyword, mode: 'insensitive' } },
            { specification: { contains: keyword, mode: 'insensitive' } },
          ] } } },
          { captureSessions: { some: { draftBatchNumber: { contains: keyword, mode: 'insensitive' } } } },
        ],
      } : {}),
    };

    const [items, active, incomplete, warnings, recycled] = await Promise.all([
      prisma.materialLibraryItem.findMany({
        where,
        include: materialLibraryItemInclude,
        orderBy: [{ updatedAt: 'desc' }, { code: 'asc' }],
        take: limitedNumber(search.get('limit')),
      }),
      prisma.materialLibraryItem.count({ where: { deletedAt: null } }),
      prisma.materialLibraryItem.count({ where: { deletedAt: null, photos: { none: { deletedAt: null } } } }),
      prisma.materialLibraryItem.count({ where: { deletedAt: null, warningState: { not: MaterialLibraryWarningState.NONE } } }),
      prisma.materialLibraryItem.count({ where: { deletedAt: { not: null } } }),
    ]);

    return NextResponse.json({
      ok: true,
      items: items.map(serializeMaterialItem),
      summary: { active, incomplete, warnings, recycled },
      permissions: {
        create: user.laborRole === 'ADMIN' || user.access.capabilities.includes('QUALITY:CREATE'),
        update: user.laborRole === 'ADMIN' || user.access.capabilities.includes('QUALITY:UPDATE'),
        delete: user.laborRole === 'ADMIN' || user.access.capabilities.includes('QUALITY:DELETE'),
        execute: user.laborRole === 'ADMIN' || user.access.capabilities.includes('QUALITY:EXECUTE_WORKFLOW'),
      },
    });
  } catch (error) {
    return materialLibraryRouteError(error, '物料库加载失败');
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutationRequest(request);
    const user = await requireUser();
    const actor = materialLibraryActor(user);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const data = materialItemCreateData(body);
    const category = await prisma.materialLibraryCategory.findFirst({ where: { id: data.categoryId, deletedAt: null } });
    if (!category) return NextResponse.json({ ok: false, error: '所选物料分类不存在' }, { status: 404 });

    const item = await prisma.$transaction(async tx => {
      const code = await nextMaterialLibraryCode(tx);
      const created = await tx.materialLibraryItem.create({
        data: {
          ...data,
          code,
          createdById: actor.id,
          createdByName: actor.name,
          updatedById: actor.id,
          updatedByName: actor.name,
        },
      });
      const hasSupplierVariant = Boolean(
        data.supplierName
        || data.manufacturerModel
        || data.supplierPartNumber
        || data.specification
        || data.materialComposition,
      );
      if (hasSupplierVariant) {
        await tx.materialLibrarySupplierVariant.create({
          data: {
            materialItemId: created.id,
            supplierName: data.supplierName,
            manufacturerModel: data.manufacturerModel,
            supplierPartNumber: data.supplierPartNumber,
            specification: data.specification,
            materialComposition: data.materialComposition,
            isPrimary: true,
            createdById: actor.id,
            createdByName: actor.name,
            updatedById: actor.id,
            updatedByName: actor.name,
          },
        });
      }
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'create_material_library_item',
          targetType: 'material_library_item',
          targetId: created.id,
          detail: { code: created.code, name: created.name, categoryId: created.categoryId },
        },
      });
      return tx.materialLibraryItem.findUniqueOrThrow({ where: { id: created.id }, include: materialLibraryItemInclude });
    });
    return NextResponse.json({ ok: true, item: serializeMaterialItem(item) }, { status: 201 });
  } catch (error) {
    return materialLibraryRouteError(error, '物料档案创建失败');
  }
}
