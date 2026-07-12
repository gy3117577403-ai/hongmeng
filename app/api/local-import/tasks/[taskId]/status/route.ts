import { NextRequest, NextResponse } from 'next/server';
import { localImportErrorResponse, localImportTaskSummary, requireHelperTask, updateLocalImportTaskState } from '@/lib/local-import';
import { logOp } from '@/lib/logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { taskId: string } }) {
  try {
    const { task } = await requireHelperTask(req, params.taskId);
    const body = await req.json().catch(() => ({})) as { state?: unknown };
    const state = typeof body.state === 'string' ? body.state : '';
    await updateLocalImportTaskState(task, state);
    await logOp({
      userId: task.userId,
      action: 'local_import_task_status',
      targetType: 'local_import_task',
      targetId: task.id,
      detail: { state },
    });
    const refreshed = await requireHelperTask(req, params.taskId);
    return NextResponse.json({ ok: true, data: { summary: await localImportTaskSummary(refreshed.task) } });
  } catch (error) {
    const result = localImportErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
