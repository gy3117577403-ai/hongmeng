import type { Prisma } from '@prisma/client';

export const ADMIN_EXCLUDED_NOTIFICATION_SOURCES = ['QUALITY_FIXTURE', 'QUALITY_REVIEW_REWORK', 'PURCHASING', 'DRAWING_LIBRARY', 'DRAWING_CHANGE'] as const;
export type RoutingNotification = { category?: string | null; sourceType?: string | null; eventType?: string | null; actorId?: string | null; sourceId?: string | null };
export function excludedAdminNotice(input: RoutingNotification): boolean {
  return (ADMIN_EXCLUDED_NOTIFICATION_SOURCES as readonly string[]).includes(String(input.sourceType || '').toUpperCase())
    || /^(?:QUALITY_FIXTURE_|QUALITY_REVIEW_REWORK|PURCHASING_|DRAWING_LIBRARY_|DRAWING_CHANGE_)/.test(String(input.eventType || '').toUpperCase());
}
export function delegatedApprovalNotice(input: RoutingNotification): boolean {
  if (excludedAdminNotice(input)) return false;
  const event = input.eventType || '';
  if (/(?:APPROVED|RETURNED|REJECTED|CANCELLED|COMPLETED|RESOLVED)$/i.test(event)) return false;
  return input.category === 'APPROVAL' || supportedHandoffApproval(input);
}
export function supportedHandoffApproval(input: RoutingNotification): boolean {
  return /^(?:other_work_(?:submit|policy_change|correction)|PROCESS_COMPLETION_WITHDRAWAL_REQUEST_PENDING|PROCESS_REPORT_SUBMISSION_(?:PENDING|REASSIGNED)|PROCESS_ROUTE_CHANGE_(?:SUBMITTED|REEVALUATED)|MAJOR_QUALITY_FINAL_APPROVAL_REQUESTED)$/i.test(input.eventType || '');
}
/** Called before persistence, so badges, inboxes and realtime delivery share exactly the same recipients. */
export async function routeBusinessRecipients(tx: Prisma.TransactionClient, input: RoutingNotification, candidates: readonly string[]): Promise<string[]> {
  const ids = [...new Set(candidates.filter(Boolean))];
  if (!ids.length) return ids;
  const policies = await tx.businessApprovalHandoff.findMany({ where: { isActive: true, fromUserId: { in: ids } } });
  if (!policies.length) return ids;
  const activeTargets = await tx.user.findMany({ where: { id: { in: policies.map(row => row.toUserId) }, isActive: true, accountStatus: 'ACTIVE', OR: [{ employeeId: null }, { employee: { is: { isActive: true } } }] }, select: { id: true, employeeId: true, accessGrants: { where: { isActive: true, effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] }, select: { profile: true, scopeKey: true } } } });
  const required = /PROCESS_ROUTE_CHANGE_/.test(input.eventType || '') ? 'workflows' : /other_work_/i.test(input.eventType || '') ? 'other-hours-approval' : /PROCESS_(?:REPORT|COMPLETION)/.test(input.eventType || '') ? 'reporting-recovery' : 'major-approval';
  const targets = new Set(activeTargets.filter(row => row.accessGrants.some(grant => grant.profile === 'MODULE_ACCESS' && grant.scopeKey === 'MODULES:ON') && row.accessGrants.some(grant => grant.profile === 'MODULE_ACCESS' && grant.scopeKey === `MODULE:${required}:COLLABORATE`)).map(row => row.id));
  const independentFrom = new Set([input.actorId].filter(Boolean));
  const independentEmployees = new Set<string>();
  if (/^other_work_(?:submit|policy_change|correction)$/i.test(input.eventType || '') && input.sourceId) {
    const request = await tx.otherWorkTimeRequest.findUnique({ where: { id: input.sourceId }, select: { employeeId: true, createdById: true } });
    if (request) { independentFrom.add(request.createdById); independentEmployees.add(request.employeeId); }
  }
  if (input.eventType === 'MAJOR_QUALITY_FINAL_APPROVAL_REQUESTED' && input.sourceId) {
    const approval = await tx.issueMajorApproval.findUnique({ where: { id: input.sourceId }, select: { submittedById: true, qualityReviewedById: true } });
    if (approval?.submittedById) independentFrom.add(approval.submittedById);
    if (approval?.qualityReviewedById) independentFrom.add(approval.qualityReviewedById);
  }
  if (/^PROCESS_ROUTE_CHANGE_(?:SUBMITTED|REEVALUATED)$/.test(input.eventType || '') && input.sourceId) {
    const change = await tx.processRouteChange.findUnique({ where: { id: input.sourceId }, select: { createdById: true } });
    if (change?.createdById) independentFrom.add(change.createdById);
  }
  const result = new Set(ids);
  for (const policy of policies) {
    if (excludedAdminNotice(input)) result.delete(policy.fromUserId);
    else if (supportedHandoffApproval(input) && targets.has(policy.toUserId) && !independentFrom.has(policy.toUserId) && !independentEmployees.has(activeTargets.find(target => target.id === policy.toUserId)?.employeeId || '')) {
      result.delete(policy.fromUserId);
      result.add(policy.toUserId);
    }
    // Keep the source as fallback if the delegate is inactive or submitted the request.
  }
  return [...result];
}
