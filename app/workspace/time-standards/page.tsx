import { redirect } from 'next/navigation';
import StandardTimeShell from '@/components/StandardTimeShell';
import { currentUser } from '@/lib/auth';
import './time-standard-workbench.css';

export default async function TimeStandardsPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=%2Fworkspace%2Ftime-standards');
  return <StandardTimeShell user={user} />;
}
