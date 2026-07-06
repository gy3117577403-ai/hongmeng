import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { commitEmptyDrawingLibraryCleanup, previewEmptyDrawingLibraryCleanup } from '@/lib/drawing-library-cleanup';
import { logOp } from '@/lib/logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    if (String(body.confirmText || '').trim() !== 'CLEAN_EMPTY') {
      return NextResponse.json({ ok: false, error: '请输入 CLEAN_EMPTY 确认清理空资料记录' }, { status: 400 });
    }
    const before = await previewEmptyDrawingLibraryCleanup();
    const result = await commitEmptyDrawingLibraryCleanup();
    await logOp({
      userId: user.id,
      action: 'cleanup_empty_drawing_library',
      targetType: 'drawing_library_item',
      detail: {
        cleanedCount: result.count,
        candidateCount: before.candidateCount,
        retainedCount: before.retainedCount,
        preservedWorkOrders: before.workOrderCount,
        preservedConnectorParameters: before.connectorParameterCount,
        preservedConnectorParameterFiles: before.connectorParameterFileCount,
      },
    });
    return NextResponse.json({ ok: true, summary: { ...before, cleanedCount: result.count } });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '空图纸资料清理失败' }, { status: 500 });
  }
}
