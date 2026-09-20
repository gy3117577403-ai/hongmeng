import { requirePageAccess } from '@/lib/page-access';
import { redirect } from 'next/navigation';
import QualityDataMobile from '@/components/quality-data/QualityDataMobile';
import '@/app/workspace/quality/data/quality-data.css';
export const dynamic = 'force-dynamic';
export default async function QualityCapturePage({ params, searchParams }: { params: { code: string }; searchParams: { type?: string; stepId?: string } }) {
  const path = '/quality-capture/' + encodeURIComponent(params.code);
  const query = new URLSearchParams();
  if(searchParams.type === 'FIRST')query.set('type','FIRST');
  if(searchParams.stepId)query.set('stepId',searchParams.stepId);
  const user = await requirePageAccess(path, path + (query.size ? '?' + query : ''));
  if (searchParams.type === 'FIRST') redirect('/workspace/quality/data?type=FIRST');
  return <QualityDataMobile code={params.code} user={user} initialType={searchParams.type} initialStepId={searchParams.stepId}/>;
}
