import { redirect } from 'next/navigation';
import IssueManagementShell from '@/components/IssueManagementShell';
import { currentUser } from '@/lib/auth';
import './issues-workbench.css';

export default async function IssueManagementPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  return <IssueManagementShell user={user} />;
}
