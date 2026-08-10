import EmployeeAttainmentReportShell from '@/components/EmployeeAttainmentReportShell';
import { requirePageAccess } from '@/lib/page-access';
import './employee-attainment-report.css';

export default async function ReportsPage() {
  const user = await requirePageAccess('/workspace/reports');
  return <EmployeeAttainmentReportShell user={user} />;
}
