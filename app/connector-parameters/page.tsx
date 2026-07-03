import { redirect } from 'next/navigation';
import { ConnectorParametersShell } from '@/components/ConnectorParametersShell';
import { currentUser } from '@/lib/auth';

export default async function ConnectorParametersPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  return <ConnectorParametersShell user={user} />;
}
