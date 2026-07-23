import { redirect } from 'next/navigation';
import WorkflowCenterShell from '@/components/WorkflowCenterShell';
import { currentUser } from '@/lib/auth';
import './workflow-center.css';

export default async function WorkflowCenterPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=%2Fworkspace%2Fworkflows');
  if (user.laborRole === 'EMPLOYEE') redirect('/workspace/reports?view=labor');
  return <WorkflowCenterShell user={user} />;
}
