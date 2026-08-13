import AbnormalTimeWorkbench from '@/components/AbnormalTimeWorkbench';
import { requirePageAccess } from '@/lib/page-access';
import './abnormal-time-workbench.css';

export const dynamic = 'force-dynamic';

export default async function AbnormalTimePage() {
  const user = await requirePageAccess('/workspace/abnormal-times');
  return <AbnormalTimeWorkbench user={user} />;
}
