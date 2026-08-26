import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/auth';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import { internalQualityRiskInclude, serializeInternalQualityRisk } from '@/lib/internal-quality-risks';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { deleteObjectsBestEffort, putObject } from '@/lib/s3';
import { safeFilename, validateFileContent } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const categories = ['DEFECT', 'CAUSE', 'ACTION', 'VERIFICATION', 'SOLUTION', 'EVIDENCE'] as const;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let objectKey = '';
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireCapability('QUALITY', 'UPDATE');
    const report = await prisma.internalQualityRiskReport.findFirst({ where: { id: params.id, deletedAt: null }, select: { id: true, status: true } });
    if (!report) return NextResponse.json({ ok: false, error: '内部质量异常不存在或已进入回收站' }, { status: 404 });
    if (report.status === 'ARCHIVED') return NextResponse.json({ ok: false, error: '已归档版本不可增删证据，请先启动修订' }, { status: 409 });
    const form = await req.formData();
    const upload = form.get('file');
    if (!(upload instanceof File)) return NextResponse.json({ ok: false, error: '请选择要上传的照片或文件' }, { status: 400 });
    const categoryText = String(form.get('category') || 'EVIDENCE').trim().toUpperCase();
    if (!categories.includes(categoryText as typeof categories[number])) return NextResponse.json({ ok: false, error: '证据分类无效' }, { status: 400 });
    const taskId = String(form.get('taskId') || '').trim() || null;
    if (taskId) {
      const task = await prisma.internalQualityRiskTask.findFirst({ where: { id: taskId, reportId: params.id }, select: { id: true } });
      if (!task) return NextResponse.json({ ok: false, error: '关联协同任务不存在' }, { status: 409 });
    }
    const body = Buffer.from(await upload.arrayBuffer());
    const validationError = validateFileContent(upload.name, upload.type, upload.size, body);
    if (validationError) return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
    const mimeType = upload.type || 'application/octet-stream';
    objectKey = `quality-risks/${params.id}/${crypto.randomUUID()}-${safeFilename(upload.name)}`;
    await putObject({ key: objectKey, body, contentType: mimeType, originalName: upload.name });
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    const result = await prisma.$transaction(async tx => {
      const attachment = await tx.internalQualityRiskAttachment.create({ data: {
        reportId: params.id,
        taskId,
        category: categoryText,
        originalName: upload.name.slice(0, 240),
        displayName: String(form.get('displayName') || upload.name).trim().slice(0, 240) || upload.name.slice(0, 240),
        mimeType,
        fileSize: upload.size,
        objectKey,
        sha256,
        caption: String(form.get('caption') || '').trim().slice(0, 500) || null,
        uploadedById: user.id,
      } });
      await tx.internalQualityRiskReport.update({ where: { id: params.id }, data: { updatedById: user.id, version: { increment: 1 } } });
      await tx.internalQualityRiskActivity.create({ data: {
        reportId: params.id,
        action: 'ATTACHMENT_UPLOADED',
        content: `上传${categoryText}证据：${upload.name.slice(0, 160)}`,
        actorId: user.id,
        actorName: user.displayName || user.username,
        detail: { attachmentId: attachment.id, taskId, category: categoryText, sha256 },
      } });
      return tx.internalQualityRiskReport.findUniqueOrThrow({ where: { id: params.id }, include: internalQualityRiskInclude });
    });
    await logOp({ userId: user.id, action: 'upload_internal_quality_risk_attachment', targetType: 'internal_quality_risk', targetId: params.id, detail: { category: categoryText, size: upload.size, sha256 } });
    return NextResponse.json({ ok: true, report: serializeInternalQualityRisk(result) });
  } catch (error) {
    if (objectKey) await deleteObjectsBestEffort([objectKey]);
    return internalQualityRiskRouteError(error, '异常证据上传失败');
  }
}
