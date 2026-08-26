import { MaterialLibraryCaptureStatus, Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import {
  materialLibraryActor,
  materialLibraryItemLockKey,
  materialLibrarySessionInclude,
  materialSessionDraftData,
  positiveVersion,
  serializeMaterialSession,
} from '@/lib/material-library';
import { materialLibraryRouteError } from '@/lib/material-library-http';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function loadSession(id: string) {
  return prisma.materialLibraryCaptureSession.findUnique({
    where: { id },
    include: materialLibrarySessionInclude,
  });
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const session = await loadSession(params.id);
    if (!session) return NextResponse.json({ ok: false, error: '拍照录入会话不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, session: serializeMaterialSession(session) });
  } catch (error) {
    return materialLibraryRouteError(error, '拍照录入会话读取失败');
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const user = await requireUser();
    const actor = materialLibraryActor(user);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const expectedVersion = positiveVersion(body.expectedVersion);
    const draft = materialSessionDraftData(body);
    const category = await prisma.materialLibraryCategory.findFirst({ where: { id: draft.categoryId, deletedAt: null } });
    if (!category) return NextResponse.json({ ok: false, error: '所选物料分类不存在' }, { status: 404 });
    const target = await prisma.materialLibraryCaptureSession.findUnique({ where: { id: params.id }, select: { materialItemId: true } });
    if (!target) throw new Error('MATERIAL_SESSION_NOT_FOUND');

    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${materialLibraryItemLockKey(target.materialItemId)}))`;
      const current = await tx.materialLibraryCaptureSession.findUnique({ where: { id: params.id } });
      if (!current) throw new Error('MATERIAL_SESSION_NOT_FOUND');
      if (current.status !== MaterialLibraryCaptureStatus.ACTIVE) throw new Error('MATERIAL_SESSION_CLOSED');
      if (current.version !== expectedVersion) throw new Error('MATERIAL_SESSION_CONFLICT');
      const updated = await tx.materialLibraryCaptureSession.updateMany({
        where: { id: current.id, status: MaterialLibraryCaptureStatus.ACTIVE, version: expectedVersion },
        data: {
          ...draft,
          connectedById: current.connectedById || actor.id,
          connectedByName: current.connectedByName || actor.name,
          connectedAt: current.connectedAt || new Date(),
          lastSeenAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new Error('MATERIAL_SESSION_CONFLICT');
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'update_material_library_capture_draft',
          targetType: 'material_library_capture_session',
          targetId: current.id,
          detail: { materialItemId: current.materialItemId, expectedVersion },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    const session = await loadSession(params.id);
    if (!session) throw new Error('MATERIAL_SESSION_NOT_FOUND');
    return NextResponse.json({ ok: true, session: serializeMaterialSession(session) });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'MATERIAL_SESSION_NOT_FOUND') return NextResponse.json({ ok: false, error: '拍照录入会话不存在' }, { status: 404 });
      if (error.message === 'MATERIAL_SESSION_CLOSED') return NextResponse.json({ ok: false, error: '该录入会话已结束，不能继续修改' }, { status: 409 });
      if (error.message === 'MATERIAL_SESSION_CONFLICT') return NextResponse.json({ ok: false, error: '录入数据已被更新，请刷新后重试' }, { status: 409 });
    }
    return materialLibraryRouteError(error, '录入数据保存失败');
  }
}
