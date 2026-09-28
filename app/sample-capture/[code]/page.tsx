import SampleCaptureMobile from '@/components/SampleCaptureMobile';
import { requireMobileSession } from '@/lib/page-access';
import { canAccessAppRoute } from '@/lib/app-route-access';
import MobileSampleAccessNotice from '@/components/sample-library/MobileSampleAccessNotice';
import '../../sample-team-workbench.css';

export const dynamic = 'force-dynamic';

export default async function SampleCapturePage({ params, searchParams }: { params: { code: string }; searchParams?: { tab?: string } }) {
  const next = `/sample-capture/${encodeURIComponent(params.code)}${searchParams?.tab === 'photos' ? '?tab=photos' : ''}`;
  const user = await requireMobileSession(next);
  if (!canAccessAppRoute(user.access, next)) return <MobileSampleAccessNotice displayName={user.displayName} username={user.username} next={next} capture />;
  return <SampleCaptureMobile key={`${user.id}:${params.code}`} code={params.code} user={user} />;
}
