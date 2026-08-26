import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { materialLibraryActor, requiredMaterialText, serializeMaterialCategory } from '@/lib/material-library';
import { materialLibraryRouteError } from '@/lib/material-library-http';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    const categories = await prisma.materialLibraryCategory.findMany({
      where: { deletedAt: null },
      include: { _count: { select: { items: { where: { deletedAt: null } } } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return NextResponse.json({ ok: true, categories: categories.map(serializeMaterialCategory) });
  } catch (error) {
    return materialLibraryRouteError(error, '物料分类加载失败');
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutationRequest(request);
    const user = await requireUser();
    const actor = materialLibraryActor(user);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const name = requiredMaterialText(body.name, '分类名称', 80);
    const last = await prisma.materialLibraryCategory.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
    const category = await prisma.$transaction(async tx => {
      const created = await tx.materialLibraryCategory.create({
        data: {
          code: `CUSTOM-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          name,
          sortOrder: (last?.sortOrder || 0) + 10,
          isSystem: false,
          createdById: actor.id,
          createdByName: actor.name,
          updatedById: actor.id,
          updatedByName: actor.name,
        },
        include: { _count: { select: { items: true } } },
      });
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'create_material_library_category',
          targetType: 'material_library_category',
          targetId: created.id,
          detail: { code: created.code, name },
        },
      });
      return created;
    });
    return NextResponse.json({ ok: true, category: serializeMaterialCategory(category) }, { status: 201 });
  } catch (error) {
    return materialLibraryRouteError(error, '物料分类创建失败');
  }
}
