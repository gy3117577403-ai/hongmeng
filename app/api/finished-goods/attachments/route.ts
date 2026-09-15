import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { putObject, signedUrl, deleteObjectsBestEffort } from '@/lib/s3';
import { FinishedGoodsError, fgRequired, fgRecord } from '@/lib/finished-goods-domain';
import { fgErrorResponse } from '@/lib/finished-goods-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  try {
    const actor = await requireUser();
    const length = Number(request.headers.get('content-length') || 0);
    if (length > 21 * 1024 * 1024) throw new FinishedGoodsError('附件不能超过 20 MB');
    const form = await request.formData(); const shipmentId = fgRequired(form.get('shipmentId'), '发货单', 100); const file = form.get('file');
    if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024) throw new FinishedGoodsError('请选择 20 MB 以内的照片或 PDF');
    if (!await prisma.fgShipment.findUnique({ where: { id: shipmentId } })) throw new FinishedGoodsError('发货单不存在');
    const body = Buffer.from(await file.arrayBuffer());
    const contentType = body.subarray(0,5).toString() === '%PDF-' ? 'application/pdf' : body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff ? 'image/jpeg' : body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : body.subarray(0,4).toString() === 'RIFF' && body.subarray(8,12).toString() === 'WEBP' ? 'image/webp' : '';
    if (!contentType) throw new FinishedGoodsError('仅支持真实的 JPG、PNG、WebP 和 PDF 文件');
    const originalName = file.name.slice(0,200); const key = `finished-goods/${shipmentId}/${randomUUID()}`;
    await putObject({ key, body, contentType, originalName });
    try {
      const saved = await prisma.fgAttachment.create({ data: { shipmentId, objectKey: key, originalName, contentType, size: body.length, actorName: actor.displayName || actor.username } });
      return NextResponse.json({ ok: true, data: { id: saved.id, originalName: saved.originalName } });
    } catch (error) { await deleteObjectsBestEffort([key]); throw error; }
  } catch (error) { return fgErrorResponse(error); }
}
export async function GET(request: NextRequest) {
  try {
    await requireUser(); const id = fgRequired(request.nextUrl.searchParams.get('id'), '附件', 100);
    const file = await prisma.fgAttachment.findFirst({ where: { id, deletedAt: null } });
    if (!file) throw new FinishedGoodsError('附件已移除或不存在', 'FG_NOT_FOUND', 404);
    return NextResponse.redirect(await signedUrl({ key: file.objectKey, filename: file.originalName, disposition: request.nextUrl.searchParams.get('download') ? 'attachment' : 'inline', contentType: file.contentType }));
  } catch (error) { return fgErrorResponse(error); }
}
export async function DELETE(request: NextRequest) {
  try {
    await requireUser(); const body = fgRecord(await request.json());
    await prisma.fgAttachment.updateMany({ where: { id: fgRequired(body.id, '附件', 100), deletedAt: null }, data: { deletedAt: new Date() } });
    return NextResponse.json({ ok: true });
  } catch (error) { return fgErrorResponse(error); }
}
