import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { ResourceUploadError, uploadWorkOrderResource } from '@/lib/work-order-resource-upload';
import { validateFile } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type UploadFailureDetail = {
  reason: string;
  message?: string;
  fileName?: string;
  fileSize?: number;
  workOrderId?: string;
  categoryId?: string;
  retry?: boolean;
};

async function logUploadFailed(userId: string, detail: UploadFailureDetail) {
  try {
    await logOp({ userId, action: 'upload_failed', targetType: 'resource_file', detail });
  } catch {
    // Failure diagnostics must never replace the upload response.
  }
}
export async function POST(req: NextRequest) {
  let userId = '';
  let failureDetail: Partial<UploadFailureDetail> = {};
  try {
    const user = await requireUser();
    userId = user.id;
    const form = await req.formData();
    const workOrderId = String(form.get('workOrderId') || '');
    const categoryId = String(form.get('categoryId') || '');
    const retry = String(form.get('retry') || '') === 'true';
    const upload = form.get('file');
    failureDetail = { workOrderId, categoryId, retry };

    if (!workOrderId) throw new ResourceUploadError('未选择工单', 400);
    if (!categoryId) throw new ResourceUploadError('未选择分类', 400);
    if (!(upload instanceof File)) throw new ResourceUploadError('请选择文件', 400);
    failureDetail = { ...failureDetail, fileName: upload.name, fileSize: upload.size };
    const validationError = validateFile(upload.name, upload.type, upload.size);
    if (validationError) throw new ResourceUploadError(validationError, 400);

    const result = await uploadWorkOrderResource({
      userId: user.id,
      workOrderId,
      categoryId,
      file: {
        name: upload.name,
        mimeType: upload.type || 'application/octet-stream',
        size: upload.size,
        body: Buffer.from(await upload.arrayBuffer()),
      },
      logAction: retry ? 'upload_retry' : 'upload',
      logDetail: { retry },
    });
    return NextResponse.json({ file: result.file, drawingLibrarySync: result.drawingLibrarySync });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const message = error instanceof ResourceUploadError ? error.message : '上传失败，请检查对象存储配置';
    if (userId) {
      await logUploadFailed(userId, {
        ...failureDetail,
        reason: error instanceof ResourceUploadError ? 'validation_or_target_error' : 'storage_or_server_error',
        message,
      } as UploadFailureDetail);
    }
    if (error instanceof ResourceUploadError) return NextResponse.json({ message }, { status: error.status });
    console.error('resource file upload failed', error);
    return NextResponse.json({ message }, { status: 500 });
  }
}
