import AttendanceManagementShell from '@/components/AttendanceManagementShell';
import { requirePageAccess } from '@/lib/page-access';
import './attendance-workbench.css';

export const dynamic = 'force-dynamic';

export default async function AttendancePage() {
  const user = await requirePageAccess('/workspace/attendance');
  return <AttendanceManagementShell user={user} />;
}
