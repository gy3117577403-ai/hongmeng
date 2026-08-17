import SampleCaptureMobile from '@/components/SampleCaptureMobile';
import { requirePageAccess } from '@/lib/page-access';
import '../../sample-team-workbench.css';

export const dynamic = 'force-dynamic';

export default async function SampleCapturePage({ params }: { params: { code: string } }) {
  const next = `/sample-capture/${encodeURIComponent(params.code)}`;
  const user = await requirePageAccess(next);
  return <SampleCaptureMobile code={params.code} user={user} />;
}
