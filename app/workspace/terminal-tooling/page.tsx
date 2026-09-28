import ToolingOperations from '@/components/tooling/ToolingOperations';
import { requirePageAccess } from '@/lib/page-access';
import './terminal-tooling-workbench.css';
import './tooling-operations.css';
import './terminal-blade-editor.css';

export default async function TerminalToolingPage() {
  const user = await requirePageAccess('/workspace/terminal-tooling');
  return <ToolingOperations user={user} />;
}
