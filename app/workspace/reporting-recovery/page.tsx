import { redirect } from 'next/navigation';
import ReportingRecoveryShell from '@/components/ReportingRecoveryShell';
import { canAccessAppRoute } from '@/lib/app-route-access';
import { requirePageAccess } from '@/lib/page-access';

export const dynamic = 'force-dynamic';
export default async function ReportingRecoveryPage({ searchParams }: { searchParams: { id?: string; submissionId?: string; keyword?: string } }) {
  const user = await requirePageAccess('/workspace/reporting-recovery');
  const submissionId = searchParams.id || searchParams.submissionId || '';
  // Keep existing notification links usable for field reporters. The legacy
  // APIs still limit records to the creator, assigned handlers or administrator.
  if (!canAccessAppRoute(user.access, '/production')) {
    return <ReportingRecoveryShell user={user} initialSubmissionId={submissionId} initialKeyword={searchParams.keyword || ''} />;
  }
  const query = new URLSearchParams({ recovery: '1' });
  if (submissionId) query.set('submissionId', submissionId);
  if (searchParams.keyword) query.set('keyword', searchParams.keyword);
  redirect(`/production?${query}`);
}
