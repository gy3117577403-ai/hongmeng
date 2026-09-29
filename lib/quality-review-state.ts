import { fixtureSubmissionIssues, type FixtureDocumentPackage } from './quality-fixture-documents';

export type ReviewPackageState = FixtureDocumentPackage & { id: string; status: string; sequence: number };
export type ReviewReturnState = { status: string; submittedPackageId: string | null; responseText: string; responseFileId: string | null };
export type ReviewDecision = { state: string; label: string; action: 'EDIT' | 'SUBMIT' | 'RETURNS' | 'REVIEW' | 'CURRENT' | 'HISTORY' | 'RECONCILE'; actionLabel: string; packageId: string | null; reason: string };
export const pendingDocumentReview = (status: string) => ['REVIEWING', 'SUPERVISOR', 'QUALITY'].includes(status);

/** One decision for labels, list badges and the primary action. No role-specific UI guesses. */
export function documentReviewDecision(p: ReviewPackageState | null | undefined, issues: ReviewReturnState[], currentFileIds?: string[], latestId?: string): ReviewDecision {
  const result = (state: string, label: string, action: ReviewDecision['action'], actionLabel: string, reason = '', packageId = p?.id || null): ReviewDecision => ({ state, label, action, actionLabel, reason, packageId });
  if (p && latestId && p.id !== latestId) return result('HISTORICAL', '历史资料', 'CURRENT', '查看当前资料', '', latestId);
  const active = issues.filter(i => i.status !== 'RESOLVED');
  if (active.some(i => i.status === 'REVIEWING' && (i.submittedPackageId !== p?.id || !p || !pendingDocumentReview(p.status))))
    return result('REPAIR', '审核关联待核对', 'RECONCILE', '核对审核关联', '复核事项与当前资料未对齐');
  if (p && pendingDocumentReview(p.status)) {
    if (active.some(i => i.status !== 'REVIEWING' || i.submittedPackageId !== p.id)) return result('REPAIR', '审核关联待核对', 'RECONCILE', '核对审核关联');
    return result(p.status, p.status === 'SUPERVISOR' ? '待主管审核' : p.status === 'QUALITY' ? '待品质审核' : '待双方审核', 'REVIEW', '查看审核进度');
  }
  if (active.length) {
    const ready = active.every(i => i.status === 'READY' && i.responseText.trim() && (!i.responseFileId || !currentFileIds || currentFileIds.includes(i.responseFileId)));
    return ready ? result('RETURN_READY', '已回复 · 待重新提交', 'RETURNS', '重新提交审核')
      : result('RETURN_OPEN', '退回待处理', 'RETURNS', '处理退回', '逐项核对当前资料与技术回复');
  }
  if (p?.status === 'APPROVED') return result('APPROVED', '资料已审核', 'HISTORY', '查看审核记录');
  if (p?.status === 'DRAFT') {
    const missing = fixtureSubmissionIssues(p);
    return missing.length ? result('INCOMPLETE', '待补充资料', 'EDIT', '补充资料', missing.join('；'))
      : result('READY', p.sequence > 1 ? '资料待重新提交' : '可提交审核', 'SUBMIT', p.sequence > 1 ? '提交当前资料重新审核' : '提交双方审核');
  }
  return result('INCOMPLETE', p?.status === 'STALE' ? '资料已变更 · 待重新提交' : '待补充资料', 'EDIT', '补充当前资料');
}
