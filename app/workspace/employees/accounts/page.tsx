import EmployeeAccountsWorkbench from '@/components/EmployeeAccountsWorkbench';
import { requirePageAccess } from '@/lib/page-access';
import './employee-accounts.css';

export const dynamic = 'force-dynamic';

export default async function EmployeeAccountsPage() {
  const user = await requirePageAccess('/workspace/employees/accounts');
  return <EmployeeAccountsWorkbench user={user} />;
}
