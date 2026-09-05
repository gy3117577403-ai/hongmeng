import { requirePageAccess } from '@/lib/page-access';
import QualityDataMobile from '@/components/quality-data/QualityDataMobile';
import '@/app/workspace/quality/data/quality-data.css';
export const dynamic = 'force-dynamic';
export default async function QualityCapturePage({ params }: { params: { code: string } }) {
  const user = await requirePageAccess('/quality-capture/' + encodeURIComponent(params.code));
  return <QualityDataMobile code={params.code} user={user}/>;
}
