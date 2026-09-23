import { redirect } from 'next/navigation';
import { otherWorkScope } from '@/lib/other-work-time-access';
import OtherWorkHours from '@/components/OtherWorkHours';
import { requirePageAccess } from '@/lib/page-access';
export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const query = new URLSearchParams();
  for (const key of ['id', 'from', 'to', 'status', 'employeeId']) {
    const value = searchParams[key];
    if (typeof value === 'string') query.set(key, value);
  }
  const path = '/workspace/other-hours/approvals';
  const user = await requirePageAccess(path, path + (query.size ? '?' + query : ''));
  if (!otherWorkScope(user).manage && !user.access.modulePermissions?.collaboration) redirect('/field-report/other-hours');
  return <OtherWorkHours user={user} approval />;
}
