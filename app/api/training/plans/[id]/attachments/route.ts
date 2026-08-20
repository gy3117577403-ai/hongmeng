import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { deleteObjectsBestEffort, putObject } from '@/lib/s3';
import { cleanTrainingText, TRAINING_ATTACHMENT_KINDS, TrainingInputError, type TrainingAttachmentKind } from '@/lib/training';
import { safeFilename } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const allowedExtensions = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'docx', 'xlsx', 'pptx', 'mp4']);
const officeExtensions = new Set(['docx', 'xlsx', 'pptx']);

function extension(name: string): string {
  return name.toLowerCase().split('.').pop() || '';
}

function validateAttachment(file: File, body: Buffer): string | null {
  const ext = extension(file.name);
  const maximum = Math.min((Number(process.env.MAX_UPLOAD_SIZE_MB || 50) || 50) * 1024 * 1024, 100 * 1024 * 1024);
  if (!allowedExtensions.has(ext)) return '培训附件仅支持 PDF、图片、DOCX、XLSX、PPTX 和 MP4';
  if (!file.size || !body.length) return '文件为空';
  if (file.size > maximum) return `单文件不能超过 ${Math.floor(maximum / 1024 / 1024)}MB`;
  if (ext === 'pdf' && body.subarray(0, 5).toString() !== '%PDF-') return 'PDF 文件头无效';
  if (['jpg', 'jpeg'].includes(ext) && !(body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff)) return 'JPEG 文件头无效';
  if (ext === 'png' && body.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return 'PNG 文件头无效';
  if (ext === 'webp' && !(body.subarray(0, 4).toString() === 'RIFF' && body.subarray(8, 12).toString() === 'WEBP')) return 'WEBP 文件头无效';
  if (officeExtensions.has(ext) && body.subarray(0, 4).toString('hex') !== '504b0304') return 'Office 文件结构无效';
  if (ext === 'mp4' && body.subarray(4, 8).toString() !== 'ftyp') return 'MP4 文件头无效';
  return null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const plan = await prisma.trainingPlan.findFirst({ where: { id: params.id, deletedAt: null }, select: { id: true, code: true, status: true } });
    if (!plan) return NextResponse.json({ ok: false, error: '培训计划不存在或已删除' }, { status: 404 });
    const form = await req.formData();
    const upload = form.get('file');
    if (!(upload instanceof File)) throw new TrainingInputError('请选择培训附件');
    const body = Buffer.from(await upload.arrayBuffer());
    const error = validateAttachment(upload, body);
    if (error) throw new TrainingInputError(error);
    const rawKind = cleanTrainingText(form.get('kind'), 40) as TrainingAttachmentKind;
    const kind = TRAINING_ATTACHMENT_KINDS.includes(rawKind) ? rawKind : 'OTHER';
    const mimeType = upload.type || 'application/octet-stream';
    const objectKey = `training/${plan.code}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeFilename(upload.name)}`;
    await putObject({ key: objectKey, body, contentType: mimeType, originalName: upload.name });
    let attachment;
    try {
      attachment = await prisma.$transaction(async tx => {
        const created = await tx.trainingAttachment.create({
          data: {
            planId: plan.id,
            kind,
            objectKey,
            originalName: upload.name.slice(0, 240),
            mimeType,
            size: BigInt(upload.size),
            uploadedById: user.id,
          },
        });
        await tx.trainingActivity.create({
          data: { planId: plan.id, action: 'upload_attachment', content: `上传${kind}：${upload.name.slice(0, 160)}`, actorId: user.id, detail: { attachmentId: created.id, size: upload.size } },
        });
        await tx.trainingPlan.update({ where: { id: plan.id }, data: { updatedById: user.id, version: { increment: 1 } } });
        return created;
      });
    } catch (reason) {
      await deleteObjectsBestEffort([objectKey]);
      throw reason;
    }
    await logOp({ userId: user.id, action: 'upload_training_attachment', targetType: 'training_attachment', targetId: attachment.id, detail: { planId: plan.id, kind, mimeType, size: upload.size } });
    return NextResponse.json({
      ok: true,
      attachment: { id: attachment.id, kind, name: attachment.originalName, mimeType, size: upload.size, contentUrl: `/api/training/attachments/${attachment.id}/content` },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof TrainingInputError) return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    console.error('training attachment upload failed', error);
    return NextResponse.json({ ok: false, error: '培训附件上传失败' }, { status: 500 });
  }
}
