import { NextRequest, NextResponse } from 'next/server';
import { ForbiddenError, requireAdmin } from '@/lib/auth';
import { hasCapability } from '@/lib/department-access';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { trainingApiError } from '@/lib/training-api';
import { permanentlyDeleteTrainingPlan, previewTrainingPlanPurge } from '@/lib/training-plan-purge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireTrainingPurgeAdmin() {
  const user = await requireAdmin();
  if (user.laborRole !== 'ADMIN' && !hasCapability(user.access, 'TRAINING', 'DELETE') && !hasCapability(user.access, 'HR', 'DELETE')) throw new ForbiddenError();
  return user;
}

function respondError(error: unknown) {
  if (error instanceof ForbiddenError) return NextResponse.json({ ok: false, error: '仅有培训删除权限的管理员可以永久删除' }, { status: 403 });
  return trainingApiError(error, '永久删除失败，请刷新后重试', 'training permanent delete failed');
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireTrainingPurgeAdmin();
    return NextResponse.json({ ok: true, preview: await previewTrainingPlanPurge(params.id) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return respondError(error); }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireTrainingPurgeAdmin();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const result = await permanentlyDeleteTrainingPlan({
      id: params.id, actorId: user.id, reason: body.reason, confirmationCode: body.confirmationCode,
      previewToken: body.previewToken, confirmed: body.confirmed, invalidateFacts: body.invalidateFacts,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) { return respondError(error); }
}
