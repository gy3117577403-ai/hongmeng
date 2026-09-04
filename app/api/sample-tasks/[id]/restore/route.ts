import { NextRequest, NextResponse } from 'next/server';
import { ForbiddenError, UnauthorizedError, requireSystemAdministrator, unauthorized } from '@/lib/auth';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { sampleActor } from '@/lib/sample-team';
import { restoreSampleTask, SampleTaskDeletionError } from '@/lib/sample-task-deletion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const user = await requireSystemAdministrator();
    const actor = sampleActor(user);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const task = await restoreSampleTask({
      id: params.id,
      actorId: actor.id,
      actorName: actor.name,
      reason: body.reason,
      confirmationCode: body.confirmationCode,
      expectedVersion: body.expectedVersion,
      confirmed: body.confirmed,
    });
    return NextResponse.json({ ok: true, task });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return NextResponse.json({ ok: false, error: '仅系统管理员可以恢复样品任务' }, { status: 403 });
    if (error instanceof SampleTaskDeletionError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    console.error('sample task restore failed', error);
    return NextResponse.json({ ok: false, error: '样品任务恢复失败，请刷新后重试' }, { status: 500 });
  }
}
