import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { detailOtherWork, mutateOtherWorkAttachment, OtherWorkError } from '@/lib/other-work-time-service';
import { otherWorkErrorResponse } from '@/lib/other-work-time-http';
import { putObject, deleteObjectsBestEffort } from '@/lib/s3';
import { safeFilename, validateFileContent } from '@/lib/validation';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const actor = await requireUser();
    const detail = await detailOtherWork(actor, params.id);
    if (!detail.row.permissions.edit) throw new OtherWorkError('提交后的照片已锁定', 403);
    if (Number(req.headers.get('content-length') || 0) > 13 * 1024 * 1024) throw new OtherWorkError('照片不能超过 12 MB');
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size > 12 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new OtherWorkError('请选择 12 MB 以内的 JPG、PNG 或 WebP 照片');
    const body = Buffer.from(await file.arrayBuffer());
    const invalid = validateFileContent(file.name, file.type, file.size, body);
    if (invalid) throw new OtherWorkError(invalid);
    const objectKey = 'other-work-times/' + params.id + '/' + crypto.randomUUID() + '-' + safeFilename(file.name);
    await putObject({ key: objectKey, body, contentType: file.type, originalName: file.name });
    try {
      const row = await mutateOtherWorkAttachment(actor, params.id, Number(form.get('version')), { objectKey, originalName: file.name.slice(0, 240), size: file.size, mimeType: file.type });
      return NextResponse.json({ ok: true, row });
    } catch (error) { await deleteObjectsBestEffort([objectKey]); throw error; }
  } catch (error) { return otherWorkErrorResponse(error); }
}
