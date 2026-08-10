import WorkflowCenterShell from '@/components/WorkflowCenterShell';
import { requirePageAccess } from '@/lib/page-access';
import './workflow-center.css';

export default async function WorkflowCenterPage() {
  const user = await requirePageAccess('/workspace/workflows');
  return <WorkflowCenterShell user={user} />;
}
