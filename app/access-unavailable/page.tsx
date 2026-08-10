import { redirect } from 'next/navigation';
import AccessUnavailableShell from '@/components/AccessUnavailableShell';
import { landingRouteForAccess } from '@/lib/app-route-access';
import { currentUser } from '@/lib/auth';
import './access-unavailable.css';

export const dynamic = 'force-dynamic';

export default async function AccessUnavailablePage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.mustChangePassword) {
    const next = landingRouteForAccess(user.access);
    redirect(`/change-password?next=${encodeURIComponent(next)}`);
  }
  return <AccessUnavailableShell fieldReportOnly={user.access.modules.includes('FIELD_REPORT')} />;
}
