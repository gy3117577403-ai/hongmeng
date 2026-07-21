import { redirect } from 'next/navigation';
import EmployeeManagementShell from '@/components/EmployeeManagementShell';
import { currentUser } from '@/lib/auth';
import './employee-workbench.css';

export const dynamic = 'force-dynamic';

export default async function EmployeesPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=%2Fworkspace%2Femployees');
  return <EmployeeManagementShell user={user} />;
}
