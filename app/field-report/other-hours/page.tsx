import OtherWorkHours from '@/components/OtherWorkHours';
import { requirePageAccess } from '@/lib/page-access';
export const metadata = { title: '其他工时申报 · 杭连协同平台' };
export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const query = new URLSearchParams();
  for (const key of ['id', 'from', 'to', 'status', 'employeeId']) {
    const value = searchParams[key];
    if (typeof value === 'string') query.set(key, value);
  }
  const path = '/field-report/other-hours';
  const user = await requirePageAccess(path, path + (query.size ? '?' + query : ''));
  // Preserve the original record and date filters through login.
  return <OtherWorkHours user={user} field />;
}
