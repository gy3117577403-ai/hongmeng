import { ConnectorAssemblyManualShell } from '@/components/ConnectorAssemblyManualShell';
import { requirePageAccess } from '@/lib/page-access';
import './connector-assembly-manuals-workbench.css';

export const dynamic = 'force-dynamic';

export default async function ConnectorAssemblyManualPage() {
  const user = await requirePageAccess('/connector-assembly-manuals');
  return <ConnectorAssemblyManualShell user={user} />;
}
