import crypto from 'node:crypto';
import { MaterialLibraryUploadMode, Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import {
  createMaterialUploadCode,
  hashMaterialUploadCode,
  materialLibraryActor,
  materialLibraryItemLockKey,
  materialLibrarySessionInclude,
  materialUploadMode,
  requiredMaterialText,
  serializeMaterialUploadLink,
} from '@/lib/material-library';
import { materialLibraryRouteError } from '@/lib/material-library-http';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const uploadLinkInclude = {
  sessions: {
    include: materialLibrarySessionInclude,
    orderBy: { createdAt: 'desc' as const },
    take: 1,
  },
};

type UploadLinkRecord = Prisma.MaterialLibraryUploadLinkGetPayload<{ include: typeof uploadLinkInclude }>;

function dto(link: UploadLinkRecord) {
  return serializeMaterialUploadLink({ ...link, latestSession: link.sessions[0] || null });
}

export async function GET(request: NextRequest) {
  try {
    await requireUser();
    const materialItemId = requiredMaterialText(request.nextUrl.searchParams.get('materialItemId'), '物料', 80);
    const links = await prisma.materialLibraryUploadLink.findMany({
      where: { materialItemId, status: 'ACTIVE' },
      include: uploadLinkInclude,
      orderBy: [{ mode: 'asc' }, { createdAt: 'desc' }],
      take: 12,
    });
    return NextResponse.json({ ok: true, links: links.map(dto) });
  } catch (error) {
    return materialLibraryRouteError(error, '物料上传二维码加载失败');
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutationRequest(request);
    const user = await requireUser();
    const actor = materialLibraryActor(user);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const materialItemId = requiredMaterialText(body.materialItemId, '物料', 80);
    const mode = materialUploadMode(body.mode) as MaterialLibraryUploadMode;
    const item = await prisma.materialLibraryItem.findFirst({ where: { id: materialItemId, deletedAt: null } });
    if (!item) return NextResponse.json({ ok: false, error: '物料档案不存在或已在回收站' }, { status: 404 });

    const requestedMinutes = Number(body.expiresInMinutes);
    const minutes = Number.isInteger(requestedMinutes) && requestedMinutes >= 5
      ? Math.min(requestedMinutes, 24 * 60)
      : 30;
    const expiresAt = mode === MaterialLibraryUploadMode.TEMPORARY
      ? new Date(Date.now() + minutes * 60_000)
      : null;
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${materialLibraryItemLockKey(materialItemId)}))`;
      const currentItem = await tx.materialLibraryItem.findFirst({ where: { id: materialItemId, deletedAt: null } });
      if (!currentItem) throw new Error('MATERIAL_ITEM_DELETED');
      if (mode === MaterialLibraryUploadMode.PERMANENT) {
        const existing = await tx.materialLibraryUploadLink.findFirst({
          where: { materialItemId, mode, status: 'ACTIVE' },
          include: uploadLinkInclude,
          orderBy: { createdAt: 'desc' },
        });
        if (existing) return { link: existing, reused: true };
      }
      const id = crypto.randomUUID();
      const generation = 1;
      const code = createMaterialUploadCode({ id, generation, materialItemId, mode });
      const created = await tx.materialLibraryUploadLink.create({
        data: {
          id,
          materialItemId,
          mode,
          generation,
          tokenHash: hashMaterialUploadCode(code),
          expiresAt,
          createdById: actor.id,
          createdByName: actor.name,
        },
        include: uploadLinkInclude,
      });
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'create_material_library_upload_link',
          targetType: 'material_library_upload_link',
          targetId: created.id,
          detail: { materialItemId, mode, expiresAt: expiresAt?.toISOString() || null, credentialEmbedded: false },
        },
      });
      return { link: created, reused: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return NextResponse.json({ ok: true, link: dto(result.link), reused: result.reused }, { status: result.reused ? 200 : 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'MATERIAL_ITEM_DELETED') {
      return NextResponse.json({ ok: false, error: '物料档案不存在或已在回收站' }, { status: 404 });
    }
    return materialLibraryRouteError(error, '物料上传二维码生成失败');
  }
}
