import { redirect } from 'next/navigation';
import AttendanceManagementShell from '@/components/AttendanceManagementShell';
import { currentUser } from '@/lib/auth';
import './attendance-workbench.css';

export const dynamic = 'force-dynamic';

export default async function AttendancePage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=%2Fworkspace%2Fattendance');
  return <AttendanceManagementShell user={user} />;
}
