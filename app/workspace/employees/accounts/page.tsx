import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/page-access';
export const dynamic = 'force-dynamic';
export default async function EmployeeAccountsPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePageAccess('/workspace/employees/accounts');
  const params = new URLSearchParams({ accountAccess: '1' });
  if (typeof searchParams.employeeId === 'string') { params.set('view', 'directory'); params.set('employeeId', searchParams.employeeId); params.set('accountEmployee', searchParams.employeeId); }
  redirect(`/workspace/employees?${params}`);
}
