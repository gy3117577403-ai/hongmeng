import MaterialFollowUpShell from '@/components/MaterialFollowUpShell';
import { requirePageAccess } from '@/lib/page-access';
import './material-follow-up-workbench.css';

export default async function MaterialFollowUpPage() {
  const user = await requirePageAccess('/workspace/procurement');
  return <MaterialFollowUpShell user={user} />;
}
