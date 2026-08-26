import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/auth';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import { internalQualityRiskInclude, serializeInternalQualityRisk } from '@/lib/internal-quality-risks';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, { params }: { params: { id: string; attachmentId: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireCapability('QUALITY', 'UPDATE');
    const report = await prisma.internalQualityRiskReport.findFirst({ where: { id: params.id, deletedAt: null }, select: { status: true } });
    if (!report) return NextResponse.json({ ok: false, error: '内部质量异常不存在或已进入回收站' }, { status: 404 });
    if (report.status === 'ARCHIVED') return NextResponse.json({ ok: false, error: '已归档证据不可删除，请先启动修订' }, { status: 409 });
    const attachment = await prisma.internalQualityRiskAttachment.findFirst({ where: { id: params.attachmentId, reportId: params.id, deletedAt: null }, select: { id: true, displayName: true } });
    if (!attachment) return NextResponse.json({ ok: false, error: '证据文件不存在或已删除' }, { status: 404 });
    const archivedReference = await prisma.internalQualityRiskRevisionAttachment.findFirst({
      where: { attachmentId: attachment.id },
      select: { revision: { select: { revisionNumber: true } } },
    });
    if (archivedReference) {
      return NextResponse.json({
        ok: false,
        error: `该证据已固化在归档版本 R${archivedReference.revision.revisionNumber}，不可删除；可上传替代证据并发布下一版本`,
      }, { status: 409 });
    }
    const result = await prisma.$transaction(async tx => {
      await tx.internalQualityRiskAttachment.update({ where: { id: attachment.id }, data: { deletedAt: new Date() } });
      await tx.internalQualityRiskReport.update({ where: { id: params.id }, data: { updatedById: user.id, version: { increment: 1 } } });
      await tx.internalQualityRiskActivity.create({ data: { reportId: params.id, action: 'ATTACHMENT_DELETED', content: `移除证据：${attachment.displayName}`, actorId: user.id, actorName: user.displayName || user.username, detail: { attachmentId: attachment.id } } });
      return tx.internalQualityRiskReport.findUniqueOrThrow({ where: { id: params.id }, include: internalQualityRiskInclude });
    });
    await logOp({ userId: user.id, action: 'delete_internal_quality_risk_attachment', targetType: 'internal_quality_risk_attachment', targetId: attachment.id, detail: { reportId: params.id } });
    return NextResponse.json({ ok: true, report: serializeInternalQualityRisk(result) });
  } catch (error) {
    return internalQualityRiskRouteError(error, '异常证据删除失败');
  }
}
