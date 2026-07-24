import { redirect } from 'next/navigation';
import MaterialFollowUpShell from '@/components/MaterialFollowUpShell';
import { currentUser } from '@/lib/auth';
import './material-follow-up-workbench.css';

export default async function MaterialFollowUpPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=%2Fworkspace%2Fprocurement');
  return <MaterialFollowUpShell user={user} />;
}
