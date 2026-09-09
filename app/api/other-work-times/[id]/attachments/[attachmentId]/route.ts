import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { canReadOtherWork, mutateOtherWorkAttachment, OtherWorkError } from '@/lib/other-work-time-service';
import { otherWorkErrorResponse, otherWorkJson } from '@/lib/other-work-time-http';
import { getObjectStream } from '@/lib/s3';
export const dynamic = 'force-dynamic';
type Params = { params: { id: string; attachmentId: string } };
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireUser();
    const file = await prisma.otherWorkTimeAttachment.findFirst({ where: { id: params.attachmentId, requestId: params.id, deletedAt: null }, include: { request: true } });
    if (!file || !canReadOtherWork(actor, file.request)) throw new OtherWorkError('照片不存在或无权查看', 404);
    return new NextResponse(Readable.toWeb(await getObjectStream(file.objectKey)) as ReadableStream, { headers: { 'Content-Type': file.mimeType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return otherWorkErrorResponse(error); }
}
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    assertSameOriginMutationRequest(req);
    const data = await otherWorkJson(req);
    return NextResponse.json({ ok: true, row: await mutateOtherWorkAttachment(await requireUser(), params.id, Number(data.version), { deleteId: params.attachmentId }) });
  } catch (error) { return otherWorkErrorResponse(error); }
}
