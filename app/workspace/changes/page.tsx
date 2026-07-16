import { redirect } from 'next/navigation';
import ChangeManagementShell from '@/components/ChangeManagementShell';
import { currentUser } from '@/lib/auth';
import './change-workbench.css';

export default async function ChangeManagementPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=%2Fworkspace%2Fchanges');
  return <ChangeManagementShell user={user} />;
}
