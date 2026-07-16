import { redirect } from 'next/navigation';
import EmployeeAttainmentReportShell from '@/components/EmployeeAttainmentReportShell';
import { currentUser } from '@/lib/auth';
import './employee-attainment-report.css';

export default async function ReportsPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=%2Fworkspace%2Freports');
  return <EmployeeAttainmentReportShell user={user} />;
}
