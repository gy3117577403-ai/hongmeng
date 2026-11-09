import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { putObject, signedUrl, deleteObjectsBestEffort } from '@/lib/s3';
import { materialLossAccess } from '@/lib/material-loss-access';
import { MaterialLossError } from '@/lib/material-loss-domain';
import { materialLossFailure } from '@/lib/material-loss-http';
import { getMaterialLoss } from '@/lib/material-loss-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const LIMIT = 10 * 1024 * 1024;
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(); await getMaterialLoss(params.id, user.id);
    const attachment = await prisma.materialLossAttachment.findFirst({ where: { id: req.nextUrl.searchParams.get('file') || '', lossId: params.id, deletedAt: null } });
    if (!attachment) throw new MaterialLossError('附件不存在或已移除', 404);
    return NextResponse.redirect(await signedUrl({ key: attachment.objectKey, filename: attachment.originalName, contentType: attachment.contentType, disposition: req.nextUrl.searchParams.has('download') ? 'attachment' : 'inline' }));
  } catch (e) { return materialLossFailure(e); }
}
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let uploadedKey: string | null = null;
  try {
    const user = await requireUser(), access = await materialLossAccess(user.id);
    if (!access.report) throw new MaterialLossError('没有物料损耗申报权限', 403);
    if (Number(req.headers.get('content-length') || 0) > LIMIT + 100000) throw new MaterialLossError('附件最多 10 MB');
    const form = await req.formData(), file = form.get('file'), version = Number(form.get('version'));
    if (!(file instanceof File) || !file.size || file.size > LIMIT) throw new MaterialLossError('请选择 10 MB 以内的 PDF 或图片');
    const prior = await prisma.materialLoss.findUnique({ where: { id: params.id }, select: { applicantId: true, status: true, version: true } });
    if (!prior || prior.applicantId !== user.id) throw new MaterialLossError('只能修改本人申报的附件', 403);
    if (!['DRAFT', 'RETURNED', 'WITHDRAWN'].includes(prior.status) || prior.version !== version) throw new MaterialLossError('记录已更新，请刷新核对后上传附件', 409);
    const body = Buffer.from(await file.arrayBuffer());
    const contentType = body.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf' : body[0] === 255 && body[1] === 216 && body[2] === 255 ? 'image/jpeg' : body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png' : body.subarray(0, 4).toString() === 'RIFF' && body.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : '';
    if (!contentType) throw new MaterialLossError('仅支持真实的 PDF、JPG、PNG、WebP 文件');
    const objectKey = `material-loss/${params.id}/${randomUUID()}`, originalName = file.name.slice(0, 200);
    await putObject({ key: objectKey, body, contentType, originalName }); uploadedKey = objectKey;
    const result = await prisma.$transaction(async tx => {
      const actor = await materialLossAccess(user.id, tx);
      await tx.$queryRaw`SELECT id FROM material_losses WHERE id = ${params.id} FOR UPDATE`;
      const record = await tx.materialLoss.findUnique({ where: { id: params.id } });
      if (!actor.report || record?.applicantId !== user.id) throw new MaterialLossError('只能修改本人申报的附件', 403);
      if (!['DRAFT', 'RETURNED', 'WITHDRAWN'].includes(record.status)) throw new MaterialLossError('提交后附件不可修改，请先撤回', 409);
      if (version !== record.version) throw new MaterialLossError('记录已更新，请刷新后重试', 409);
      if (await tx.materialLossAttachment.count({ where: { lossId: params.id, deletedAt: null } }) >= 8) throw new MaterialLossError('每单最多 8 个附件');
      const saved = await tx.materialLossAttachment.create({ data: { lossId: params.id, objectKey, originalName, contentType, size: body.length, actorId: user.id } });
      await tx.materialLossEvent.create({ data: { lossId: params.id, action: 'attachment_add', actorId: user.id, actorName: actor.name, note: originalName, snapshot: { attachmentId: saved.id, originalName, size: body.length } } });
      await tx.materialLoss.update({ where: { id: params.id }, data: { version: { increment: 1 } } });
      return { id: saved.id, originalName, version: record.version + 1 };
    });
    uploadedKey = null;
    return NextResponse.json({ ok: true, ...result });
  } catch (e) { if (uploadedKey) await deleteObjectsBestEffort([uploadedKey]); return materialLossFailure(e); }
}
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(), input = await req.json();
    await prisma.$transaction(async tx => {
      const actor = await materialLossAccess(user.id, tx);
      await tx.$queryRaw`SELECT id FROM material_losses WHERE id = ${params.id} FOR UPDATE`;
      const record = await tx.materialLoss.findUnique({ where: { id: params.id } });
      if (!actor.report || record?.applicantId !== user.id) throw new MaterialLossError('只能修改本人申报的附件', 403);
      if (!['DRAFT', 'RETURNED', 'WITHDRAWN'].includes(record.status) || input.version !== record.version) throw new MaterialLossError('状态已变化，请刷新核对', 409);
      const removed = await tx.materialLossAttachment.updateMany({ where: { id: String(input.file || ''), lossId: params.id, deletedAt: null }, data: { deletedAt: new Date() } });
      if (!removed.count) throw new MaterialLossError('附件不存在或已移除', 404);
      await tx.materialLoss.update({ where: { id: params.id }, data: { version: { increment: 1 } } });
      await tx.materialLossEvent.create({ data: { lossId: params.id, action: 'attachment_remove', actorId: user.id, actorName: actor.name, note: '移除附件，原文件保留', snapshot: { attachmentId: String(input.file) } } });
    });
    return NextResponse.json({ ok: true });
  } catch (e) { return materialLossFailure(e); }
}
