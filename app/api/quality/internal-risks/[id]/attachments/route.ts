import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireQualityRiskParticipant, qualityRiskActor } from '@/lib/quality-risk-access';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import { InternalQualityRiskError, internalQualityRiskInclude, serializeInternalQualityRisk } from '@/lib/internal-quality-risks';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { deleteObjectsBestEffort, putObject } from '@/lib/s3';
import { safeFilename, validateFileContent } from '@/lib/validation';
import { readQualityImageGeometry } from '@/lib/quality-image-metadata';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const categories = ['DEFECT', 'CAUSE', 'ACTION', 'VERIFICATION', 'SOLUTION', 'EVIDENCE'] as const;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let objectKey = '';
  let committed = false;
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireQualityRiskParticipant(params.id, 'task');
    const report = await prisma.internalQualityRiskReport.findFirst({ where: { id: params.id, deletedAt: null }, select: { id: true, status: true } });
    if (!report) return NextResponse.json({ ok: false, error: '内部质量异常不存在或已进入回收站' }, { status: 404 });
    if (report.status === 'ARCHIVED') return NextResponse.json({ ok: false, error: '已归档版本不可增删证据，请先启动修订' }, { status: 409 });
    const form = await req.formData();
    const upload = form.get('file');
    if (!(upload instanceof File)) return NextResponse.json({ ok: false, error: '请选择要上传的照片或文件' }, { status: 400 });
    const categoryText = String(form.get('category') || 'EVIDENCE').trim().toUpperCase();
    if (!categories.includes(categoryText as typeof categories[number])) return NextResponse.json({ ok: false, error: '证据分类无效' }, { status: 400 });
    const taskId = String(form.get('taskId') || '').trim() || null;
    const ownership = await prisma.internalQualityRiskReport.findUnique({ where: { id: params.id }, select: { ownerUserId: true } });
    if (!qualityRiskActor(user).canManage && ownership?.ownerUserId !== user.id) {
      const ownTask = taskId ? await prisma.internalQualityRiskTask.findFirst({ where: { id: taskId, reportId: params.id, ownerUserId: user.id } }) : null;
      if (!ownTask) return NextResponse.json({ ok: false, error: '协同人只能上传到自己的任务' }, { status: 403 });
    }
    if (taskId) {
      const task = await prisma.internalQualityRiskTask.findFirst({ where: { id: taskId, reportId: params.id }, select: { id: true } });
      if (!task) return NextResponse.json({ ok: false, error: '关联协同任务不存在' }, { status: 409 });
    }
    const body = Buffer.from(await upload.arrayBuffer());
    const validationError = validateFileContent(upload.name, upload.type, upload.size, body);
    if (validationError) return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
    const mimeType = upload.type || 'application/octet-stream';
    let geometry = {};
    if (mimeType.startsWith('image/')) {
      try { geometry = await readQualityImageGeometry(body); }
      catch (error) { return NextResponse.json({ ok: false, error: `图片无法解析：${error instanceof Error ? error.message : '内容损坏或像素过大'}` }, { status: 400 }); }
    }
    objectKey = `quality-risks/${params.id}/${crypto.randomUUID()}-${safeFilename(upload.name)}`;
    await putObject({ key: objectKey, body, contentType: mimeType, originalName: upload.name });
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`internal-quality-risk:${params.id}`}))`;
      const current = await tx.internalQualityRiskReport.findFirst({ where: { id: params.id, deletedAt: null, status: { not: 'ARCHIVED' } } });
      if (!current) throw new InternalQualityRiskError('归档或删除后不可继续上传', 409);
      const currentTask = taskId ? await tx.internalQualityRiskTask.findFirst({ where: { id: taskId, reportId: params.id } }) : null;
      if (taskId && !currentTask) throw new InternalQualityRiskError('关联任务已变化，请刷新后重试', 409);
      if (!qualityRiskActor(user).canManage && current.ownerUserId !== user.id && currentTask?.ownerUserId !== user.id) {
        throw new InternalQualityRiskError('任务已改派，不能继续上传证据', 403);
      }
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
        ...geometry,
        caption: String(form.get('caption') || '').trim().slice(0, 500) || null,
        uploadedById: user.id,
      } });
      await tx.internalQualityRiskReport.update({ where: { id: params.id }, data: { updatedById: user.id, version: { increment: 1 }, ...(['VERIFYING', 'PENDING_CLOSE'].includes(current.status) ? { status: 'COLLABORATING', verifiedAt: null, verifiedById: null } : {}) } });
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
    committed = true;
    await logOp({ userId: user.id, action: 'upload_internal_quality_risk_attachment', targetType: 'internal_quality_risk', targetId: params.id, detail: { category: categoryText, size: upload.size, sha256 } });
    return NextResponse.json({ ok: true, report: serializeInternalQualityRisk(result) });
  } catch (error) {
    if (objectKey && !committed) await deleteObjectsBestEffort([objectKey]);
    return internalQualityRiskRouteError(error, '异常证据上传失败');
  }
}
