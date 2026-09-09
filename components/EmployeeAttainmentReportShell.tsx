'use client';

import { useSearchParams } from 'next/navigation';
import ReportCenterBranchDashboard from '@/components/ReportCenterBranchDashboard';
import type { CurrentUserDTO } from '@/types';
import '@/app/workspace/reports/report-center-branches.css';

/** Historical entry points share the report center's hours contract and exports. */
export default function EmployeeAttainmentReportShell({ user }: { user: CurrentUserDTO }) {
  const params = useSearchParams();
  const ledger = params.get('view') === 'manual' || params.get('view') === 'labor';
  return <ReportCenterBranchDashboard user={user} initialDomain="people" initialBranch={ledger ? 'labor-ledger' : 'employee-attainment'} />;
}
