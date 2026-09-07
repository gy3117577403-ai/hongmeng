import { requirePageAccess } from '@/lib/page-access';
import ReportingRecoveryShell from '@/components/ReportingRecoveryShell';
import './reporting-recovery.css';

export const dynamic = 'force-dynamic';
export default async function ReportingRecoveryPage({ searchParams }: { searchParams: { id?: string } }) {
  const returnTo = '/workspace/reporting-recovery' + (searchParams.id ? '?id=' + encodeURIComponent(searchParams.id) : '');
  return <ReportingRecoveryShell user={await requirePageAccess('/workspace/reporting-recovery', returnTo)} />;
}
