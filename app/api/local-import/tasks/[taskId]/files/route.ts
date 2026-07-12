import { NextRequest, NextResponse } from 'next/server';
import { localImportErrorResponse, localImportTaskSummary, requireHelperTask } from '@/lib/local-import';
import { logOp } from '@/lib/logs';
import {
  inspectResourceDuplicate,
  ResourceUploadError,
  sha256Buffer,
  uploadWorkOrderResource,
  validateResourceContent,
} from '@/lib/work-order-resource-upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RateState = { startedAt: number; count: number };
type UploadReservation = { count: number; bytes: number };
const globalRate = globalThis as unknown as {
  localImportRate?: Map<string, RateState>;
  localImportReservations?: Map<string, UploadReservation>;
};
const rateMap = globalRate.localImportRate ?? new Map<string, RateState>();
const reservationMap = globalRate.localImportReservations ?? new Map<string, UploadReservation>();
globalRate.localImportRate = rateMap;
globalRate.localImportReservations = reservationMap;

function enforceRateLimit(taskId: string) {
  const now = Date.now();
  const current = rateMap.get(taskId);
  if (!current || now - current.startedAt > 60_000) {
    rateMap.set(taskId, { startedAt: now, count: 1 });
    return;
  }
  current.count += 1;
  if (current.count > 40) throw new ResourceUploadError('上传请求过于频繁，请稍后重试', 429);
}

function reserveTaskCapacity(taskId: string, summary: Awaited<ReturnType<typeof localImportTaskSummary>>, maxFiles: number, maxTotalBytes: number, bytes: number) {
  const current = reservationMap.get(taskId) || { count: 0, bytes: 0 };
  if (summary.successCount + summary.duplicateCount + current.count >= maxFiles) {
    throw new ResourceUploadError('任务文件数量已达到上限', 409);
  }
  if (summary.uploadedBytes + current.bytes + bytes > maxTotalBytes) {
    throw new ResourceUploadError('任务累计上传大小已达到上限', 413);
  }
  reservationMap.set(taskId, { count: current.count + 1, bytes: current.bytes + bytes });
  return () => {
    const active = reservationMap.get(taskId);
    if (!active || active.count <= 1) reservationMap.delete(taskId);
    else reservationMap.set(taskId, { count: active.count - 1, bytes: Math.max(0, active.bytes - bytes) });
  };
}

export async function POST(req: NextRequest, { params }: { params: { taskId: string } }) {
  let taskUserId = '';
  let failureFileName = '';
  let failureSha256Prefix = '';
  let releaseReservation: (() => void) | null = null;
  try {
    enforceRateLimit(params.taskId);
    const { payload, task } = await requireHelperTask(req, params.taskId);
    taskUserId = task.userId;
    const form = await req.formData();
    const upload = form.get('file');
    const claimedHash = String(form.get('sha256') || '').trim().toLowerCase();
    const confirmConflict = String(form.get('confirmConflict') || '') === 'true';
    if (!(upload instanceof File)) throw new ResourceUploadError('请选择文件', 400);
    failureFileName = upload.name;
    failureSha256Prefix = /^[a-f0-9]{64}$/.test(claimedHash) ? claimedHash.slice(0, 12) : '';
    if (!/^[a-f0-9]{64}$/.test(claimedHash)) throw new ResourceUploadError('缺少有效 SHA-256', 400);
    if (upload.size > payload.maxFileBytes) throw new ResourceUploadError('文件超过任务单文件大小限制', 413);

    const body = Buffer.from(await upload.arrayBuffer());
    const mimeType = upload.type || String(form.get('mimeType') || 'application/octet-stream');
    const file = { name: upload.name, mimeType, size: upload.size, body, sha256: claimedHash };
    const contentError = validateResourceContent(file);
    if (contentError) throw new ResourceUploadError(contentError, 400);
    const actualHash = sha256Buffer(body);
    if (actualHash !== claimedHash) throw new ResourceUploadError('文件 SHA-256 与本地校验结果不一致', 400);

    const duplicate = await inspectResourceDuplicate({
      workOrderId: payload.workOrderId,
      categoryId: payload.categoryId,
      fileName: upload.name,
      size: upload.size,
      sha256: actualHash,
    });
    const summary = await localImportTaskSummary(task);
    releaseReservation = reserveTaskCapacity(
      task.id,
      summary,
      payload.maxFiles,
      payload.maxTotalBytes,
      duplicate.status === 'duplicate' ? 0 : upload.size,
    );
    if (duplicate.status === 'duplicate') {
      await logOp({
        userId: payload.userId,
        action: 'local_import_duplicate_skipped',
        targetType: 'local_import_task',
        targetId: task.id,
        detail: {
          existingFileId: duplicate.existingFileId || null,
          fileName: upload.name,
          fileSize: upload.size,
          sha256Prefix: actualHash.slice(0, 12),
        },
      });
      return NextResponse.json({ ok: true, data: { skipped: true, duplicateStatus: 'duplicate', existingFileId: duplicate.existingFileId || null } });
    }
    if (duplicate.status === 'conflict' && !confirmConflict) {
      return NextResponse.json({ ok: false, error: '同名同大小文件无法确认哈希，请在助手中确认后再上传', code: 'CONFIRM_CONFLICT' }, { status: 409 });
    }

    const result = await uploadWorkOrderResource({
      userId: payload.userId,
      workOrderId: payload.workOrderId,
      categoryId: payload.categoryId,
      file,
      logAction: 'import_file_from_local_helper',
      logTargetType: 'local_import_task',
      logTargetId: task.id,
      logDetail: { duplicateStatus: duplicate.status, helperSource: true },
    });
    return NextResponse.json({
      ok: true,
      data: {
        skipped: false,
        duplicateStatus: duplicate.status,
        resourceFile: result.file,
        drawingLibrarySync: result.drawingLibrarySync,
      },
    });
  } catch (error) {
    if (taskUserId) {
      await logOp({
        userId: taskUserId,
        action: 'local_import_file_failed',
        targetType: 'local_import_task',
        targetId: params.taskId,
        detail: {
          reason: error instanceof Error ? error.message.slice(0, 160) : 'upload_failed',
          fileName: failureFileName || null,
          sha256Prefix: failureSha256Prefix || null,
        },
      });
    }
    if (error instanceof ResourceUploadError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    console.error('local import upload failed', error);
    const result = localImportErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  } finally {
    releaseReservation?.();
  }
}
