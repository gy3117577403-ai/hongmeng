import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { materialLibraryActor, serializeMaterialPhoto, cleanMaterialText } from '@/lib/material-library';
import { materialLibraryRouteError } from '@/lib/material-library-http';
import { manageMaterialPhotos } from '@/lib/material-photo-management';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    if (user.laborRole !== 'ADMIN' && !(user.access.capabilities.includes('QUALITY:DELETE') || user.access.capabilities.includes('MATERIAL_LIBRARY:DELETE'))) return NextResponse.json({ ok: false, error: '没有查看照片回收站的权限' }, { status: 403 });
    const page = Math.max(1, Math.floor(Number(request.nextUrl.searchParams.get('page')) || 1));
    const where = { materialItemId: params.id, deletedAt: { not: null }, materialItem: { deletedAt: null } };
    const [photos, total] = await Promise.all([
      prisma.materialLibraryPhoto.findMany({ where, include: { session: { select: { sessionNo: true, draftBatchNumber: true } } }, orderBy: [{ deletedAt: 'desc' }, { id: 'asc' }], take: 40, skip: (page - 1) * 40 }),
      prisma.materialLibraryPhoto.count({ where }),
    ]);
    return NextResponse.json({ ok: true, photos: photos.map(photo => ({ ...serializeMaterialPhoto(photo), sessionNo: photo.session.sessionNo, batchNumber: photo.session.draftBatchNumber })), total, page });
  } catch (error) { return materialLibraryRouteError(error, '照片回收站读取失败'); }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const user = await requireUser(), body = await request.json();
    if (!['DELETE', 'RESTORE'].includes(body.action) || !Array.isArray(body.ids)) return NextResponse.json({ ok: false, error: '照片操作无效' }, { status: 400 });
    const result = await manageMaterialPhotos({ materialItemId: params.id, ids: body.ids, action: body.action,
      actor: materialLibraryActor(user), canDeleteArchived: user.laborRole === 'ADMIN' || (user.access.capabilities.includes('QUALITY:DELETE') || user.access.capabilities.includes('MATERIAL_LIBRARY:DELETE')),
      reason: cleanMaterialText(body.reason, 500) || '上传错误', expectedUpdatedAt: body.expectedUpdatedAt,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) { return materialLibraryRouteError(error, '照片操作失败'); }
}
