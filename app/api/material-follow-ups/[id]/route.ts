import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError, forbidden } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { materialFollowUpDetailInclude, serializeMaterialFollowUpTask } from '@/lib/material-follow-up';
import { mutateMaterialFollowUp } from '@/lib/material-exception-service';
import { MaterialInputError } from '@/lib/material-source';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const task = await prisma.materialFollowUpTask.findUnique({ where: { id: params.id }, include: materialFollowUpDetailInclude });
    if (!task) return NextResponse.json({ ok: false, error: '物料跟进不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, task: serializeMaterialFollowUpTask(task) });
  } catch (error) { if (error instanceof UnauthorizedError) return unauthorized(); throw error; }
}
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json();
    if (user.access.modulePermissions?.materials === 'READ') return forbidden();
    // Anyone signed in may append a traceable progress note. Changes to the
    // material source, owner, ETA, arrival quantity or workflow state still
    // require procurement access and are validated by the service layer.
    if (body?.action !== 'note' && !user.access.capabilities.includes('PROCUREMENT:UPDATE')) {
      // An assigned colleague can acknowledge their own task. This does not
      // grant assignment, ETA or arrival-editing permissions.
      if (body?.action !== 'claim') return forbidden();
      const assigned = await prisma.materialFollowUpTask.findUnique({ where: { id: params.id }, select: { ownerId: true } });
      if (assigned?.ownerId !== user.id) return forbidden();
    }
    const task = await mutateMaterialFollowUp(params.id, body, user.id);
    return NextResponse.json({ ok: true, task: serializeMaterialFollowUpTask(task) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof MaterialInputError) return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    console.error('material follow-up mutation failed', error);
    return NextResponse.json({ ok: false, error: '跟进保存失败，请刷新后重试' }, { status: 500 });
  }
}
