import { redirect } from 'next/navigation';
import { ConnectorAssemblyManualShell } from '@/components/ConnectorAssemblyManualShell';
import { currentUser } from '@/lib/auth';
import './connector-assembly-manuals-workbench.css';

export const dynamic = 'force-dynamic';

export default async function ConnectorAssemblyManualPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  return <ConnectorAssemblyManualShell user={user} />;
}
