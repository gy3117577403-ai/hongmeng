import { NextRequest, NextResponse } from 'next/server';
import { ForbiddenError, UnauthorizedError, requireSystemAdministrator, unauthorized } from '@/lib/auth';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { sampleActor } from '@/lib/sample-team';
import { commitSampleTestCleanup, previewSampleTestCleanup, SampleTaskDeleteMode, SampleTaskDeletionError } from '@/lib/sample-task-deletion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cleanupMode(value: unknown): SampleTaskDeleteMode {
  return value === 'RETIRE_TEST_OUTPUTS' ? value : 'REMOVE_TASK_ONLY';
}

function taskIds(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function respond(error: unknown) {
  if (error instanceof UnauthorizedError) return unauthorized();
  if (error instanceof ForbiddenError) return NextResponse.json({ ok: false, error: '仅系统管理员可以清理样品测试数据' }, { status: 403 });
  if (error instanceof SampleTaskDeletionError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  console.error('sample test cleanup failed', error);
  return NextResponse.json({ ok: false, error: '样品测试数据清理失败，请刷新后重试' }, { status: 500 });
}

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutationRequest(request);
    const user = await requireSystemAdministrator();
    const actor = sampleActor(user);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const ids = taskIds(body.taskIds);
    const mode = cleanupMode(body.mode);
    if (body.action === 'COMMIT') {
      const result = await commitSampleTestCleanup({
        taskIds: ids,
        mode,
        actorId: actor.id,
        actorName: actor.name,
        reason: body.reason,
        previewToken: body.previewToken,
        confirmationText: body.confirmationText,
        confirmed: body.confirmed,
        clientMutationId: body.clientMutationId,
      });
      return NextResponse.json({ ok: true, result });
    }
    return NextResponse.json({ ok: true, preview: await previewSampleTestCleanup(ids, mode) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return respond(error);
  }
}
