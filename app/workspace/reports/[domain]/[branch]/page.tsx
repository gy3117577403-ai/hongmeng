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
};

export default async function ReportBranchPage({ params }: BranchPageProps) {
  const pathname = `/workspace/reports/${params.domain}/${params.branch}`;
  const user = await requirePageAccess('/workspace/reports', pathname);
  const fullAccess = hasFullReportAccess(user.access.modules);
  const domain = reportDomain(params.domain);
  if (!domain || (!fullAccess && domain.key !== 'people')) {
    redirect(defaultReportRoute(user.access.modules));
  }
  const branch = reportBranch(domain.key, params.branch) || defaultReportBranch(domain.key);
  const restrictedBranch = !fullAccess
    && branch.key !== 'employee-attainment'
    && branch.key !== 'unmatched-labor';
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
