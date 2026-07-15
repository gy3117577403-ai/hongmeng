import { notFound, redirect } from 'next/navigation';
import PlannedModulePage from '@/components/home/PlannedModulePage';
import { currentUser } from '@/lib/auth';
import { getPlatformModule } from '@/lib/platform-modules';
import '../workspace-placeholder.css';

export const dynamic = 'force-dynamic';

export default async function PlatformModulePage({ params }: { params: { slug: string } }) {
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/workspace/${params.slug}`)}`);
  const definition = getPlatformModule(params.slug);
  if (!definition) notFound();
  return <PlannedModulePage module={definition} user={user} />;
}
