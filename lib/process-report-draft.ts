/** Browser-only persistence contract. Drafts never imply server acceptance. */
export type ProcessReportDraft<T = unknown> = {
  version: 1;
  ownerId: string;
  scope: string;
  value: T;
  idempotencyKey: string;
  savedAt: number;
  request?: { endpoint: string; body: Record<string, unknown> };
};

export const PROCESS_REPORT_DRAFT_PREFIX = 'hm:process-report:v1:';
export const PROCESS_REPORT_DRAFT_TTL = 7 * 24 * 60 * 60 * 1000;

export function processReportDraftKey(ownerId: string, scope: string): string {
  return `${PROCESS_REPORT_DRAFT_PREFIX}${encodeURIComponent(ownerId)}:${encodeURIComponent(scope)}`;
}

export function parseProcessReportDraft<T>(raw: string | null, ownerId: string, scope?: string, now = Date.now()): ProcessReportDraft<T> | null {
  if (!raw || !ownerId) return null;
  try {
    const draft = JSON.parse(raw) as ProcessReportDraft<T>;
    if (draft.version !== 1 || draft.ownerId !== ownerId || !draft.scope || (scope && draft.scope !== scope)
      || !draft.idempotencyKey || !Number.isFinite(draft.savedAt) || draft.savedAt > now + 60_000
      || !draft.value || typeof draft.value !== 'object') return null;
    // Unacknowledged submissions must not disappear with ordinary draft expiry.
    if (!draft.request && now - draft.savedAt > PROCESS_REPORT_DRAFT_TTL) return null;
    if (draft.request && (!/^\/api\/(?:field-report\/tickets\/[^/]+\/(?:completions|supplement-obligations\/[^/]+\/completions)|process-management\/routes\/[^/]+\/completions)$/.test(draft.request.endpoint)
      || draft.request.body?.idempotencyKey !== draft.idempotencyKey
      || draft.request.body?.expectedUserId !== ownerId)) return null;
    return draft;
  } catch { return null; }
}

export const RECOVERABLE_PROCESS_REPORT_CODES = new Set([
  'PROCESS_ACTION_REPORT_STANDARD_INVALID',
  'WIP_ALLOCATION_NOT_REPORTABLE', 'WIP_SOURCE_REPORT_EXCEEDS_NATIVE',
]);

export function processReportReceiptText(body: { pending?: boolean; submission?: { id?: string; reasonCode?: string; reasonLabel?: string; assigneeNames?: string[] } }): string {
  if (!body.pending) return '已入账，数量与工时请以报工记录为准';
  const submission = body.submission;
  if (submission?.reasonCode === 'STANDARD_MISSING') return `数量已登记，工时待核定${submission.id ? ` · ${submission.id}` : ''}。${submission.assigneeNames?.length ? `等待 ${submission.assigneeNames.join('、')} 确认标准工时。` : ''}请勿重复报工；核定后补记这笔工时。`;
  return `已申报待处理${submission?.id ? ` · ${submission.id}` : ''}。${submission?.reasonLabel || '等待主管核对报工条件'}${submission?.assigneeNames?.length ? `，待 ${submission.assigneeNames.join('、')} 处理` : ''}；尚未计入正式报工和员工工时，请勿重复申报。`;
}
