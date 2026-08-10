import ChangeManagementShell from '@/components/ChangeManagementShell';
import { requirePageAccess } from '@/lib/page-access';
import './change-workbench.css';

export default async function ChangeManagementPage() {
  const user = await requirePageAccess('/workspace/changes');
  return <ChangeManagementShell user={user} />;
}
