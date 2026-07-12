import { NextRequest, NextResponse } from 'next/server';
import { localImportErrorResponse, localImportTaskData, requireTaskViewer } from '@/lib/local-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { taskId: string } }) {
  try {
    const { task } = await requireTaskViewer(req, params.taskId);
    return NextResponse.json({ ok: true, data: await localImportTaskData(task) });
  } catch (error) {
    const result = localImportErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
