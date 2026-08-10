import { notFound } from 'next/navigation';
import PlannedModulePage from '@/components/home/PlannedModulePage';
import { requirePageAccess } from '@/lib/page-access';
import { getPlatformModule } from '@/lib/platform-modules';
import '../workspace-placeholder.css';

export const dynamic = 'force-dynamic';

export default async function PlatformModulePage({ params }: { params: { slug: string } }) {
  const definition = getPlatformModule(params.slug);
  if (!definition) notFound();
  const user = await requirePageAccess(`/workspace/${params.slug}`);
  return <PlannedModulePage module={definition} user={user} />;
}
