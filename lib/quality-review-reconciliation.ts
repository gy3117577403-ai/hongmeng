import type { Prisma } from '@prisma/client';
import type { PcActor } from './purchasing-service';
import { currentDocumentSource, documentEvidenceSignature } from './quality-fixture-sync';
import { fixtureSignaturesValid } from './quality-fixture-domain';
import { pendingDocumentReview } from './quality-review-state';
import { qfJson } from './quality-fixture-service';
import { createSystemNotification } from './system-notifications';

/** Must run under lockFixtureBusiness. Never grants approval or removes audit evidence. */
export async function reconcileDocumentReview(tx: Prisma.TransactionClient, libraryItemId: string, actor: PcActor) {
  const [packages, issues, source] = await Promise.all([
    tx.qfPackage.findMany({ where: { libraryItemId }, orderBy: { sequence: 'desc' } }),
    tx.qfDocumentReturn.findMany({ where: { libraryItemId, status: { not: 'RESOLVED' } } }),
    currentDocumentSource(tx, libraryItemId),
  ]);
  const latest = packages[0], ids = new Set([...source.drawingFiles, ...source.sopFiles].map(f => f.id));
  const latestIsCurrent = !!latest && documentEvidenceSignature(latest) === source.signature;
  const keepPending = latest && latestIsCurrent && pendingDocumentReview(latest.status) && issues.every(i => i.status === 'REVIEWING' && i.submittedPackageId === latest.id);
  const retired = packages.filter(p => pendingDocumentReview(p.status) && (!keepPending || p.id !== latest.id));
  for (const p of retired) {
    await tx.qfPackage.update({ where: { id: p.id }, data: { status: 'STALE', reason: '资料或审核关联已变更，请使用当前资料重新提交', version: { increment: 1 } } });
    await tx.qfEvent.create({ data: { entityType: 'PACKAGE', entityId: p.id, action: 'REVIEW_INVALIDATED', actorId: actor.id, actorName: actor.displayName || actor.username,
      snapshot: qfJson({ before: p, currentPackageId: latest?.id, currentSignature: source.signature }), reason: '旧轮次停止审核，原签名与技术记录保留' } });
    await tx.systemNotificationRecipient.updateMany({ where: { notification: { sourceType: 'QUALITY_FIXTURE', sourceId: p.id }, completedAt: null }, data: {
      completedAt: new Date(), completionKind: 'SOURCE_RESOLVED', completionReason: '资料已变更，转当前资料重新提交' } });
  }
  const changed = [];
  for (const issue of issues.filter(i => i.status === 'REVIEWING')) {
    if (keepPending && issue.submittedPackageId === latest.id) continue;
    const submitted = packages.find(p => p.id === issue.submittedPackageId);
    // Only repair a missed closure when that exact, current submitted round actually has valid dual signatures.
    const signed = !!submitted && submitted.id === latest?.id && latestIsCurrent && submitted.status === 'APPROVED' && fixtureSignaturesValid(submitted) && !!issue.responseText.trim() && (!issue.responseFileId || ids.has(issue.responseFileId));
    const evidenceChanged = !submitted || documentEvidenceSignature(submitted) !== source.signature;
    const reconfirm = !issue.responseText.trim() || !!issue.responseFileId && !ids.has(issue.responseFileId) || issue.kind === 'package' && evidenceChanged;
    const status = signed ? 'RESOLVED' : reconfirm ? 'OPEN' : 'READY';
    await tx.qfDocumentReturn.update({ where: { id: issue.id }, data: { status, resolvedAt: signed ? new Date() : null, version: { increment: 1 } } });
    changed.push({ id: issue.id, before: issue.status, status, submittedPackageId: issue.submittedPackageId });
  }
  if (changed.length) await tx.qfEvent.create({ data: { entityType: 'DOCUMENT_RETURN', entityId: libraryItemId, action: 'RECONCILE_REVIEW', actorId: actor.id,
    actorName: actor.displayName || actor.username, snapshot: qfJson({ currentPackageId: latest?.id, retired: retired.map(p => p.id), issues: changed }), reason: '按当前资料核对复核关联；未通过的事项保留回复并重新提交' } });
  if (latest && (retired.length || changed.some(i => i.status !== 'RESOLVED'))) {
    const settings = await tx.qfSettings.findUnique({ where: { id: 'quality-fixtures' } });
    const ids = [...new Set([...(settings?.technicalIds || []), latest.createdById, latest.submittedById, ...source.files.map(f => f.uploadedById)].filter((id): id is string => !!id))];
    const people = await tx.user.findMany({ where: { id: { in: ids }, isActive: true, accountStatus: 'ACTIVE' }, select: { id: true } });
    await createSystemNotification(tx, { eventType: 'QUALITY_REVIEW_REWORK', category: 'TODO',
      dedupeKey: 'qf-rework:' + latest.id + ':' + latest.version + ':' + issues.map(i => i.id + ':' + i.version).join(','),
      title: '资料已变更，请核对并重新送审', sourceType: 'QUALITY_REVIEW_REWORK', sourceId: libraryItemId, actorId: actor.id,
      targetRoute: '/workspace/quality-fixtures?view=review&product=' + libraryItemId, recipientUserIds: people.map(p => p.id) });
  }
  return { changed: changed.length, retired: retired.length, packageId: latest?.id || null };
}
