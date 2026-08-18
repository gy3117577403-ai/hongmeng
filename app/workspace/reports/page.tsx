import ReportCenterDashboard from '@/components/ReportCenterDashboard';
import { requirePageAccess } from '@/lib/page-access';
import './employee-attainment-report.css';

export default async function ReportsPage() {
  const user = await requirePageAccess('/workspace/reports');
  return <ReportCenterDashboard user={user} />;
}
