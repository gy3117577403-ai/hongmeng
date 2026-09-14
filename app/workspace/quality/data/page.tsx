import { requirePageAccess } from '@/lib/page-access';
import QualityDataWorkbench from '@/components/quality-data/QualityDataWorkbench';
import './quality-data.css';
export const dynamic = 'force-dynamic';
export default async function QualityDataPage({ searchParams }: { searchParams: { recordId?: string; section?: string; type?: string } }) {
  const query = new URLSearchParams();
  for(const key of ['recordId','section','type'] as const)if(searchParams[key])query.set(key,searchParams[key]!);
  const user = await requirePageAccess('/workspace/quality/data', '/workspace/quality/data' + (query.size ? '?' + query : ''));
  return <QualityDataWorkbench user={user} initialRecordId={searchParams.recordId} initialSection={searchParams.section} initialType={searchParams.type}/>;
}
