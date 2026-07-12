import { NextRequest, NextResponse } from 'next/server';
import { localImportErrorResponse, requireHelperTask } from '@/lib/local-import';
import { logOp } from '@/lib/logs';
import { inspectResourceDuplicate } from '@/lib/work-order-resource-upload';
import { validateFile } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { taskId: string } }) {
  try {
    const { payload } = await requireHelperTask(req, params.taskId);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
    const size = typeof body.size === 'number' ? body.size : Number(body.size);
    const sha256 = typeof body.sha256 === 'string' ? body.sha256.trim().toLowerCase() : '';
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType.trim().toLowerCase() : '';
    if (!fileName || !Number.isSafeInteger(size) || size <= 0 || !/^[a-f0-9]{64}$/.test(sha256)) {
      return NextResponse.json({ ok: false, error: '文件元数据不完整' }, { status: 400 });
    }
    if (size > payload.maxFileBytes) return NextResponse.json({ ok: false, error: '文件超过任务单文件大小限制' }, { status: 413 });
    const validationError = validateFile(fileName, mimeType, size);
    if (validationError) return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
    const result = await inspectResourceDuplicate({
      workOrderId: payload.workOrderId,
      categoryId: payload.categoryId,
      fileName,
      size,
      sha256,
    });
    if (result.status === 'duplicate') {
      await logOp({
        userId: payload.userId,
        action: 'local_import_duplicate_skipped',
        targetType: 'local_import_task',
        targetId: params.taskId,
        detail: {
          existingFileId: result.existingFileId || null,
          fileName,
          fileSize: size,
          sha256Prefix: sha256.slice(0, 12),
        },
      });
    }
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    const result = localImportErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
