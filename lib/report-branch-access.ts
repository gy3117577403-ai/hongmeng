import { moduleAllows, hasSubmoduleConfiguration, type ModuleAccessCarrier } from './module-permissions';
import { REPORT_DOMAINS, type ReportBranchKey } from './report-center-navigation';
const sources: Record<string, readonly string[]> = {
  'completed-batches': ['weekly-plan-attainment'],
  overview: ['process-bottlenecks', 'completeness', 'missing-route', 'missing-standard', 'missing-drawing', 'missing-material', 'sample-tasks', 'sample-attainment', 'pending-review', 'published-materials', 'review-attainment'],
  operations: ['attendance-attainment', 'team-hours', 'employee-matrix'],
  'employee-attainment': ['employee-attainment'],
  'abnormal-time': ['affected-labor', 'cause-distribution', 'open-events', 'event-ledger'],
};
export function canReadReportSource(access: ModuleAccessCarrier, source: string, query: URLSearchParams) {
  if (!hasSubmoduleConfiguration(access)) return true;
  const branch = query.get('reportBranch');
  if (!branch) return source === 'employee-attainment' && moduleAllows(access, ['employees', 'attendance']) === true;
  if (!sources[source]?.includes(branch)) return false;
  if (source === 'overview') {
    const sample = ['sample-tasks', 'sample-attainment', 'pending-review', 'published-materials', 'review-attainment'].includes(branch);
    if (query.get('mode') !== (sample ? 'sample' : 'mass')) return false;
  }
  return moduleAllows(access, [`report-${branch as ReportBranchKey}`]) === true;
}
export function firstAllowedReportPath(access: ModuleAccessCarrier) {
  for (const domain of REPORT_DOMAINS) for (const branch of domain.branches) {
    if (moduleAllows(access, [`report-${branch.key}`]) === true) return `/workspace/reports/${domain.key}/${branch.key}`;
  }
  return '/home';
}
