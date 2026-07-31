import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { loadSopWorkspaceByItemId } from '@/lib/sop/server';
import { sopRouteError } from '@/lib/sop/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const workspace = await loadSopWorkspaceByItemId(prisma, params.id);
    return NextResponse.json({ ok: true, workspace });
  } catch (error) {
    return sopRouteError(error, '加载 SOP 工作区失败');
  }
}
