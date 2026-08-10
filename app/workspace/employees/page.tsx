import EmployeeManagementShell from '@/components/EmployeeManagementShell';
import { requirePageAccess } from '@/lib/page-access';
import './employee-workbench.css';
import '../responsibilities/responsibility-collaboration.css';

export const dynamic = 'force-dynamic';

export default async function EmployeesPage() {
  const user = await requirePageAccess('/workspace/employees');
  return <EmployeeManagementShell user={user} />;
}
