import { TerminalToolingWorkbench } from '@/components/TerminalToolingWorkbench';
import { requirePageAccess } from '@/lib/page-access';
import './terminal-tooling-workbench.css';

export default async function TerminalToolingPage() {
  const user = await requirePageAccess('/workspace/terminal-tooling');
  return <TerminalToolingWorkbench user={user} />;
}
