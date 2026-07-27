import { redirect } from 'next/navigation';
import ResponsibilityCollaborationShell from '@/components/ResponsibilityCollaborationShell';
import { currentUser } from '@/lib/auth';
import './responsibility-collaboration.css';

export default async function ResponsibilityCollaborationPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=%2Fworkspace%2Fresponsibilities');
  return <ResponsibilityCollaborationShell user={user} />;
}
