import { redirect } from 'next/navigation';
import ReportCenterBranchDashboard from '@/components/ReportCenterBranchDashboard';
import {
  defaultReportBranch,
  defaultReportRoute,
  hasFullReportAccess,
  reportBranch,
  reportDomain,
  reportRoute,
  type ReportBranchKey,
  type ReportDomainKey,
} from '@/lib/report-center-navigation';
import { requirePageAccess } from '@/lib/page-access';
import '../../report-center-branches.css';

type BranchPageProps = {
  params: { domain: string; branch: string };
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function ReportBranchPage({ params, searchParams = {} }: BranchPageProps) {
  const pathname = `/workspace/reports/${params.domain}/${params.branch}`;
  const user = await requirePageAccess('/workspace/reports', pathname);
  if (params.domain === 'people' && params.branch === 'unmatched-labor') {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) if (typeof value === 'string') query.set(key, value);
    redirect(`/workspace/reports/people/employee-attainment${query.size ? `?${query}` : ''}`);
  }
  const fullAccess = hasFullReportAccess(user.access.modules);
  const domain = reportDomain(params.domain);
  if (!domain || (!fullAccess && domain.key !== 'people')) {
    redirect(defaultReportRoute(user.access.modules));
  }
  const branch = reportBranch(domain.key, params.branch) || defaultReportBranch(domain.key);
  const restrictedBranch = !fullAccess
    && branch.key !== 'employee-attainment';
  if (branch.key !== params.branch || restrictedBranch) {
    if (restrictedBranch) redirect(defaultReportRoute(user.access.modules));
    redirect(reportRoute(domain.key, branch.key));
  }
  return <ReportCenterBranchDashboard
    user={user}
    initialDomain={domain.key as ReportDomainKey}
    initialBranch={branch.key as ReportBranchKey}
  />;
}
