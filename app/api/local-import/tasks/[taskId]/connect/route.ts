import { NextRequest, NextResponse } from 'next/server';
import {
  getLocalImportTask,
  localImportErrorResponse,
  localImportTaskData,
  requireHelperTask,
  updateLocalImportTaskState,
} from '@/lib/local-import';
import { logOp } from '@/lib/logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { taskId: string } }) {
  try {
    const { task } = await requireHelperTask(req, params.taskId);
    if (task.detail.state === 'waiting') await updateLocalImportTaskState(task, 'connected');
    await logOp({
      userId: task.userId,
      action: 'local_import_helper_connected',
      targetType: 'local_import_task',
      targetId: task.id,
      detail: { connection: 'helper' },
    });
    const refreshed = await getLocalImportTask(task.id);
    return NextResponse.json({ ok: true, data: await localImportTaskData(refreshed) });
  } catch (error) {
    const result = localImportErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
