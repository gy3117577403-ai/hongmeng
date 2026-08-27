import crypto from 'node:crypto';
import { prisma } from '@/lib/prisma';

function tokenFor(id: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) throw new Error('SESSION_SECRET missing or too short');
  return `${id}.${crypto.createHmac('sha256', secret).update(`quality-warning-employee:${id}`).digest('base64url')}`;
}
const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** Stable, revision-and-order-scoped bearer URL; only hashes persist in the credential table. */
export async function qualityWarningEmployeePath(revisionId: string, workOrderId: string | null) {
  const revision = await prisma.internalQualityRiskRevision.findUnique({ where: { id: revisionId }, select: { published: true, snapshot: true, products: { select: { drawingLibraryItemId: true } }, report: { select: { deletedAt: true, warningState: true } } } });
  if (!revision?.published || revision.report.deletedAt || revision.report.warningState !== 'ACTIVE') return null;
  const snapshot = object(revision.snapshot);
  const frozenOrders = Array.isArray(snapshot.workOrders) ? snapshot.workOrders.map(object) : [];
  if (workOrderId && !frozenOrders.some(item => item.id === workOrderId)) {
    const order = await prisma.workOrder.findFirst({ where: { id: workOrderId, deletedAt: null }, select: { drawingLibraryItemId: true } });
    if (!order?.drawingLibraryItemId || !revision.products.some(item => item.drawingLibraryItemId === order.drawingLibraryItemId)) return null;
  }
  const scopeKey = `${revisionId}:${workOrderId || 'product'}`;
  const id = crypto.randomBytes(24).toString('base64url');
  const link = await prisma.qualityWarningEmployeeLink.upsert({ where: { scopeKey }, update: {}, create: { id, scopeKey, tokenHash: hash(tokenFor(id)), revisionId, workOrderId } });
  if (link.revokedAt) return null;
  const token = tokenFor(link.id);
  if (hash(token) !== link.tokenHash) return null;
  return `/quality-warning/${token}`;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function value(snapshot: Record<string, unknown>, key: string) {
  return typeof snapshot[key] === 'string' ? snapshot[key] as string : '';
}

export async function loadEmployeeQualityWarning(token: string) {
  if (!/^[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const link = await prisma.qualityWarningEmployeeLink.findUnique({ where: { tokenHash: hash(token) }, include: {
    revision: { include: { report: { select: { deletedAt: true, warningState: true, currentRevision: { select: { revisionNumber: true } } } }, attachments: { include: { attachment: true }, orderBy: { sortOrder: 'asc' } } } },
  } });
  if (!link || link.revokedAt || !link.revision.published || link.revision.report.deletedAt || link.revision.report.warningState !== 'ACTIVE') return null;
  const snapshot = object(link.revision.snapshot);
  const now = Date.now();
  if (value(snapshot, 'effectiveFrom') && new Date(value(snapshot, 'effectiveFrom')).getTime() > now) return null;
  if (value(snapshot, 'effectiveUntil') && new Date(value(snapshot, 'effectiveUntil')).getTime() < now) return null;
  const frozenAttachments = Array.isArray(snapshot.attachments) ? snapshot.attachments.map(object) : [];
  const order = link.workOrderId ? await prisma.workOrder.findUnique({ where: { id: link.workOrderId }, select: { businessCode: true, code: true, specification: true } }) : null;
  const attachments = link.revision.attachments.flatMap(({ attachment }) => {
    const frozen = frozenAttachments.find(item => item.id === attachment.id);
    if (!frozen) return [];
    return [{ id: attachment.id, displayName: value(frozen, 'displayName') || '归档附件', caption: value(frozen, 'caption'), category: value(frozen, 'category'), mimeType: attachment.mimeType,
      contentUrl: `/api/quality-warning/${token}/attachments/${attachment.id}`, objectKey: attachment.objectKey, fileSize: attachment.fileSize }];
  });
  const view = {
    reportNo: value(snapshot, 'reportNo'), title: value(snapshot, 'title'), severity: value(snapshot, 'severity'),
    revisionNumber: link.revision.revisionNumber, currentRevisionNumber: link.revision.report.currentRevision?.revisionNumber || link.revision.revisionNumber,
    archivedAt: link.revision.archivedAt.toISOString(), workOrderCode: order?.businessCode || order?.code || '',
    products: Array.isArray(snapshot.products) ? snapshot.products.map(item => value(object(item), 'specification')).filter(Boolean) : [],
    defectPhenomenon: value(snapshot, 'defectPhenomenon'), warningSummary: value(snapshot, 'warningSummary'),
    rootCause: value(snapshot, 'rootCause'), occurrenceCause: value(snapshot, 'occurrenceCause'),
    correctiveAction: value(snapshot, 'correctiveAction'), containmentAction: value(snapshot, 'containmentAction'), preventiveAction: value(snapshot, 'preventiveAction'),
    finalConclusion: value(snapshot, 'finalConclusion'), requiredAction: value(snapshot, 'requiredAction'),
    inspectionMethod: value(snapshot, 'inspectionMethod'), inspectionFrequency: value(snapshot, 'inspectionFrequency'), acceptanceCriteria: value(snapshot, 'acceptanceCriteria'), stopConditions: value(snapshot, 'stopConditions'), applicableProcess: value(snapshot, 'applicableProcess'),
    attachments: attachments.map(({ objectKey: _key, fileSize: _size, ...item }) => item),
  };
  return { view, attachments };
}
