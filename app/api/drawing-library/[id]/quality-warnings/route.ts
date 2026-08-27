import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { resolveArchivedQualityWarning } from '@/lib/internal-quality-risks';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const now = new Date();
    const item = await prisma.drawingLibraryItem.findFirst({ where: { id: params.id, deletedAt: null }, select: { id: true } });
    if (!item) return NextResponse.json({ ok: false, error: '图纸资料记录不存在' }, { status: 404 });
    const links = await prisma.internalQualityRiskRevisionProduct.findMany({
      where: {
        drawingLibraryItemId: params.id,
        revision: {
          published: true,
          currentFor: {
            is: {
              deletedAt: null,
              warningState: 'ACTIVE',
            },
          },
        },
      },
      include: {
        revision: {
          include: {
            attachments: {
              orderBy: { sortOrder: 'asc' },
              include: {
                attachment: {
                  select: { id: true, category: true, displayName: true, mimeType: true, caption: true, sha256: true, createdAt: true },
                },
              },
            },
            currentFor: true,
          },
        },
      },
      orderBy: { revision: { archivedAt: 'desc' } },
    });
    const severityRank: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
    const warnings = links.flatMap(link => {
      const report = link.revision.currentFor;
      if (!report) return [];
      const warning = resolveArchivedQualityWarning(report, link.revision.snapshot);
      const snapshot = link.revision.snapshot as Record<string, unknown>;
      const frozenAttachments = Array.isArray(snapshot.attachments) ? snapshot.attachments as Array<Record<string, unknown>> : [];
      if ((warning.effectiveFrom && warning.effectiveFrom > now) || (warning.effectiveUntil && warning.effectiveUntil < now)) return [];
      return [{
        id: report.id,
        reportNo: report.reportNo,
        ...warning,
        revisionNumber: link.revision.revisionNumber,
        archivedAt: link.revision.archivedAt.toISOString(),
        effectiveFrom: warning.effectiveFrom?.toISOString() || null,
        effectiveUntil: warning.effectiveUntil?.toISOString() || null,
        detailUrl: `/workspace/quality/internal-risks?reportId=${encodeURIComponent(report.id)}`,
        attachments: link.revision.attachments.map(({ attachment }) => ({
          ...attachment,
          ...(frozenAttachments.find(item => item.id === attachment.id) ? {
            caption: String(frozenAttachments.find(item => item.id === attachment.id)?.caption || ''),
            displayName: String(frozenAttachments.find(item => item.id === attachment.id)?.displayName || attachment.displayName),
          } : {}),
          createdAt: attachment.createdAt.toISOString(),
          contentUrl: `/api/quality/internal-risk-attachments/${encodeURIComponent(attachment.id)}/content`,
        })),
      }];
    }).sort((left, right) => (severityRank[right.severity] || 0) - (severityRank[left.severity] || 0));
    return NextResponse.json({
      ok: true,
      warnings,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '产品异常警示加载失败' }, { status: 500 });
  }
}
