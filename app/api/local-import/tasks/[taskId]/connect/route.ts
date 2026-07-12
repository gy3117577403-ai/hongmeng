import { NextRequest, NextResponse } from 'next/server';
import {
  bearerTicket,
  connectLocalImportTask,
  localImportErrorResponse,
  localImportTaskData,
  verifyLocalImportTicket,
} from '@/lib/local-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { taskId: string } }) {
  try {
    const body = await req.json().catch(() => ({})) as { helperInstanceId?: unknown };
    const helperInstanceId = typeof body.helperInstanceId === 'string' ? body.helperInstanceId : '';
    const ticketPayload = verifyLocalImportTicket(bearerTicket(req));
    const { task, ticket, alreadyConnected } = await connectLocalImportTask(params.taskId, ticketPayload, helperInstanceId);
    return NextResponse.json({
      ok: true,
      data: {
        ticket,
        alreadyConnected,
        task: await localImportTaskData(task),
      },
    });
  } catch (error) {
    const result = localImportErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
