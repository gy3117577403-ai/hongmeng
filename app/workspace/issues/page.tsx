import IssueManagementShell from '@/components/IssueManagementShell';
import { requirePageAccess } from '@/lib/page-access';
import './issues-workbench.css';

export default async function IssueManagementPage() {
  const user = await requirePageAccess('/workspace/issues');
  return <IssueManagementShell user={user} />;
}
