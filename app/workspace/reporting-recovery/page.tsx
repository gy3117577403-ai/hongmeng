import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/page-access';

export const dynamic = 'force-dynamic';
export default async function ReportingRecoveryPage({ searchParams }: { searchParams: { id?: string; keyword?: string } }) {
  await requirePageAccess('/workspace/reporting-recovery');
  const query = new URLSearchParams({ recovery: '1' });
  if (searchParams.id) query.set('submissionId', searchParams.id);
  if (searchParams.keyword) query.set('keyword', searchParams.keyword);
  redirect(`/production?${query}`);
}
