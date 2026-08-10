import AccountCenterShell from '@/components/AccountCenterShell';
import { requirePageAccess } from '@/lib/page-access';
import './account-center.css';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const user = await requirePageAccess('/account');
  return <AccountCenterShell user={user} />;
}
