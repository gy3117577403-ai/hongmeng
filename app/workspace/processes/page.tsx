import { redirect } from 'next/navigation';
import ProcessManagementShell from '@/components/ProcessManagementShell';
import { currentUser } from '@/lib/auth';
import './process-workbench.css';

export default async function ProcessManagementPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=%2Fworkspace%2Fprocesses');
  return <ProcessManagementShell user={user} />;
}
