import { ConnectorParametersShell } from '@/components/ConnectorParametersShell';
import { requirePageAccess } from '@/lib/page-access';
import './connector-parameters-workbench.css';

export default async function ConnectorParametersPage() {
  const user = await requirePageAccess('/connector-parameters');
  return <ConnectorParametersShell user={user} />;
}
