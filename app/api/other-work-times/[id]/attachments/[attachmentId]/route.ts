import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { canReadOtherWork, mutateOtherWorkAttachment, OtherWorkError } from '@/lib/other-work-time-service';
import { otherWorkErrorResponse, otherWorkJson } from '@/lib/other-work-time-http';
import { getObjectStream } from '@/lib/s3';
import { otherWorkPhotoThumbnail } from '@/lib/other-work-time-photo';
export const dynamic = 'force-dynamic';
type Params = { params: { id: string; attachmentId: string } };
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireUser();
    const file = await prisma.otherWorkTimeAttachment.findFirst({ where: { id: params.attachmentId, requestId: params.id, deletedAt: null }, include: { request: true } });
    if (!file || !canReadOtherWork(actor, file.request)) throw new OtherWorkError('照片不存在或无权查看', 404);
    const thumbnail = req.nextUrl.searchParams.get('preview') === '1';
    const etag = '"' + file.id + '-' + file.createdAt.getTime() + (thumbnail ? '-preview-v1' : '') + '"';
    const headers = { 'Content-Type': thumbnail ? 'image/webp' : file.mimeType, 'Cache-Control': 'private, no-cache', ETag: etag, 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' };
    // Always authenticate and check soft deletion before reusing a browser copy.
    if (req.headers.get('if-none-match') === etag) return new NextResponse(null, { status: 304, headers });
    if (thumbnail) {
      try { return new NextResponse(new Uint8Array(await otherWorkPhotoThumbnail(file.objectKey)), { headers: { ...headers, 'Content-Type': 'image/webp' } }); }
      catch { /* Keep the original usable when an old photo cannot be resized. */ }
    }
    return new NextResponse(Readable.toWeb(await getObjectStream(file.objectKey)) as ReadableStream, { headers: { ...headers, 'Content-Type': file.mimeType } });
  } catch (error) { return otherWorkErrorResponse(error); }
}
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    assertSameOriginMutationRequest(req);
    const data = await otherWorkJson(req);
    return NextResponse.json({ ok: true, row: await mutateOtherWorkAttachment(await requireUser(), params.id, Number(data.version), { deleteId: params.attachmentId }) });
  } catch (error) { return otherWorkErrorResponse(error); }
}
