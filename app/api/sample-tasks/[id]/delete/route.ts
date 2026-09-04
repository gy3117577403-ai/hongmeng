import { NextRequest, NextResponse } from 'next/server';
import { ForbiddenError, UnauthorizedError, requireSystemAdministrator, unauthorized } from '@/lib/auth';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { sampleActor } from '@/lib/sample-team';
import { previewSampleTaskDeletion, SampleTaskDeletionError, softDeleteSampleTask } from '@/lib/sample-task-deletion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(error: unknown) {
  if (error instanceof UnauthorizedError) return unauthorized();
  if (error instanceof ForbiddenError) return NextResponse.json({ ok: false, error: '仅系统管理员可以删除已完成样品任务' }, { status: 403 });
  if (error instanceof SampleTaskDeletionError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  console.error('sample task delete failed', error);
  return NextResponse.json({ ok: false, error: '样品任务删除失败，请刷新后重试' }, { status: 500 });
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireSystemAdministrator();
    const preview = await previewSampleTaskDeletion(params.id);
    return NextResponse.json({ ok: true, preview }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const user = await requireSystemAdministrator();
    const actor = sampleActor(user);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const result = await softDeleteSampleTask({
      id: params.id,
      actorId: actor.id,
      actorName: actor.name,
      reason: body.reason,
      confirmationCode: body.confirmationCode,
      previewToken: body.previewToken,
      expectedVersion: body.expectedVersion,
      confirmed: body.confirmed,
      clientMutationId: body.clientMutationId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
