import { MaterialLibraryCaptureStatus } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { materialLibraryActor } from '@/lib/material-library';
import { materialLibraryRouteError } from '@/lib/material-library-http';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const actor = materialLibraryActor(await requireUser());
    const result = await prisma.materialLibraryCaptureSession.updateMany({
      where: { id: params.id, status: MaterialLibraryCaptureStatus.ACTIVE },
      data: { connectedById: actor.id, connectedByName: actor.name, lastSeenAt: new Date() },
    });
    if (!result.count) return NextResponse.json({ ok: false, error: '录入会话不存在或已结束' }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return materialLibraryRouteError(error, '录入连接状态更新失败');
  }
}
