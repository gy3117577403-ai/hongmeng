import MaterialOrderWorkbench from '@/components/material/MaterialOrderWorkbench';
import { requirePageAccess } from '@/lib/page-access';
import './material-follow-up-workbench.css';

export default async function MaterialFollowUpPage() {
  const user = await requirePageAccess('/workspace/procurement');
  return <MaterialOrderWorkbench user={user} mode="tracking" />;
}
