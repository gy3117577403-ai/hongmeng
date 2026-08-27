/** Shared labels/gates: no database or secret imports, safe for the browser. */
export const QUALITY_PROBLEM_CATEGORIES = [
  { id: 'PROCESS', label: '工艺问题', department: '工艺部' },
  { id: 'QUALITY', label: '品质问题', department: '品质部' },
  { id: 'SITE', label: '现场问题', department: '生产部' },
  { id: 'MATERIAL', label: '物料问题', department: '物料/采购' },
] as const;
export const QUALITY_ANALYSIS_FIELDS = [
  ['occurrenceCause', '发生原因', true], ['rootCause', '根本原因', true],
  ['finalConclusion', '处理结论', true], ['correctiveAction', '具体解决方案', true],
  ['escapeCause', '流出原因', false], ['containmentAction', '临时遏制措施', false],
  ['preventiveAction', '预防再发措施', false], ['requiredAction', '本批作业要求', false],
] as const;
export function qualityAnalysisIssues(report: Record<string, unknown>) {
  return QUALITY_ANALYSIS_FIELDS.filter(([key, , required]) => required && !String(report[key] || '').trim())
    .map(([field, label]) => ({ field, message: `请填写${label}` }));
}
export function qualityTaskPath(reportId: string, taskId?: string | null, review = false) {
  const params = new URLSearchParams({ reportId });
  if (taskId) params.set('taskId', taskId);
  return `${review ? '/workspace/quality-confirmation' : '/workspace/quality-tasks'}?${params}`;
}
export function qualityReturnPath(path: string, query: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();
  for (const key of ['reportId', 'taskId', 'workOrderId']) {
    const value = query[key];
    if (typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value)) params.set(key, value);
  }
  return params.size ? `${path}?${params}` : path;
}
