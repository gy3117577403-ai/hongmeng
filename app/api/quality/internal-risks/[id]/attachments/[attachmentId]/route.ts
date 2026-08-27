import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/auth';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import { InternalQualityRiskError, internalQualityRiskInclude, serializeInternalQualityRisk } from '@/lib/internal-quality-risks';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string; attachmentId: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireCapability('QUALITY', 'UPDATE');
    const body = await req.json();
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`internal-quality-risk:${params.id}`}))`;
      const report = await tx.internalQualityRiskReport.findFirst({ where: { id: params.id, deletedAt: null, status: { not: 'ARCHIVED' } } });
      if (!report) throw new InternalQualityRiskError('归档版本不可修改，请先启动修订', 409);
      if (Number(body.expectedVersion) !== report.version) throw new InternalQualityRiskError('版本已变化，请刷新后重试', 409);
      const attachment = await tx.internalQualityRiskAttachment.findFirst({ where: { id: params.attachmentId, reportId: params.id, deletedAt: null } });
      if (!attachment) throw new InternalQualityRiskError('附件不存在', 404);
      const order = await tx.internalQualityRiskAttachment.findMany({ where: { reportId: params.id, deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true } });
      if (body.direction === 'up' || body.direction === 'down') {
        const index = order.findIndex(item => item.id === attachment.id); const next = index + (body.direction === 'up' ? -1 : 1);
        if (index >= 0 && next >= 0 && next < order.length) { [order[index], order[next]] = [order[next], order[index]]; }
        for (let i = 0; i < order.length; i++) await tx.internalQualityRiskAttachment.update({ where: { id: order[i].id }, data: { sortOrder: i * 10 } });
      }
      await tx.internalQualityRiskAttachment.update({ where: { id: attachment.id }, data: { ...(typeof body.caption === 'string' ? { caption: body.caption.trim().slice(0, 500) || null } : {}), ...(typeof body.printIncluded === 'boolean' ? { printIncluded: body.printIncluded } : {}) } });
      await tx.internalQualityRiskReport.update({ where: { id: params.id }, data: { version: { increment: 1 }, updatedById: user.id, ...(['VERIFYING', 'PENDING_CLOSE'].includes(report.status) ? { status: 'COLLABORATING', verifiedAt: null, verifiedById: null } : {}) } });
      await tx.internalQualityRiskActivity.create({ data: { reportId: params.id, actorId: user.id, actorName: user.displayName || user.username, action: 'ATTACHMENT_LAYOUT_UPDATED', content: '调整照片说明、打印选择或排序；旧版归档保持原样', detail: { attachmentId: attachment.id } } });
      return tx.internalQualityRiskReport.findUniqueOrThrow({ where: { id: params.id }, include: internalQualityRiskInclude });
    });
    return NextResponse.json({ ok: true, report: serializeInternalQualityRisk(result) });
  } catch (error) { return internalQualityRiskRouteError(error, error instanceof Error ? error.message : '附件设置失败'); }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string; attachmentId: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireCapability('QUALITY', 'UPDATE');
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`internal-quality-risk:${params.id}`}))`;
      const report = await tx.internalQualityRiskReport.findFirst({ where: { id: params.id, deletedAt: null } });
      if (!report) throw new InternalQualityRiskError('内部质量异常不存在或已进入回收站', 404);
      if (report.status === 'ARCHIVED') throw new InternalQualityRiskError('已归档证据不可删除，请先启动修订', 409);
      const attachment = await tx.internalQualityRiskAttachment.findFirst({ where: { id: params.attachmentId, reportId: params.id, deletedAt: null } });
      if (!attachment) throw new InternalQualityRiskError('证据文件不存在或已删除', 404);
      const reference = await tx.internalQualityRiskRevisionAttachment.findFirst({ where: { attachmentId: attachment.id }, select: { revision: { select: { revisionNumber: true } } } });
      if (reference) throw new InternalQualityRiskError(`该证据已固化在归档版本 R${reference.revision.revisionNumber}，不可删除；可上传替代证据并发布下一版本`, 409);
      await tx.internalQualityRiskAttachment.update({ where: { id: attachment.id }, data: { deletedAt: new Date() } });
      await tx.internalQualityRiskReport.update({ where: { id: params.id }, data: { updatedById: user.id, version: { increment: 1 }, ...(['VERIFYING', 'PENDING_CLOSE'].includes(report.status) ? { status: 'COLLABORATING', verifiedAt: null, verifiedById: null } : {}) } });
      await tx.internalQualityRiskActivity.create({ data: { reportId: params.id, action: 'ATTACHMENT_DELETED', content: `移除证据：${attachment.displayName}`, actorId: user.id, actorName: user.displayName || user.username, detail: { attachmentId: attachment.id } } });
      return tx.internalQualityRiskReport.findUniqueOrThrow({ where: { id: params.id }, include: internalQualityRiskInclude });
    });
    await logOp({ userId: user.id, action: 'delete_internal_quality_risk_attachment', targetType: 'internal_quality_risk_attachment', targetId: params.attachmentId, detail: { reportId: params.id } });
    return NextResponse.json({ ok: true, report: serializeInternalQualityRisk(result) });
  } catch (error) {
    return internalQualityRiskRouteError(error, '异常证据删除失败');
  }
}
