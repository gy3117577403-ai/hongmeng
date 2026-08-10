import NotificationCenterShell from '@/components/NotificationCenterShell';
import { requirePageAccess } from '@/lib/page-access';
import './messages-workbench.css';

export const dynamic = 'force-dynamic';

export default async function NotificationCenterPage() {
  const user = await requirePageAccess('/workspace/messages');
  return <NotificationCenterShell user={user} />;
}
