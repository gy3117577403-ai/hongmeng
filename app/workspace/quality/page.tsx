import QualityManagementShell from '@/components/QualityManagementShell';
import { requirePageAccess } from '@/lib/page-access';
import './quality-management.css';

export default async function QualityManagementPage() {
  const user = await requirePageAccess('/workspace/quality');
  return <QualityManagementShell user={user} />;
}
