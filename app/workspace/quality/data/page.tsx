import { requirePageAccess } from '@/lib/page-access';
import QualityDataWorkbench from '@/components/quality-data/QualityDataWorkbench';
import './quality-data.css';
export const dynamic = 'force-dynamic';
export default async function QualityDataPage({ searchParams }: { searchParams: { recordId?: string; section?: string } }) {
  const user = await requirePageAccess('/workspace/quality/data');
  return <QualityDataWorkbench user={user} initialRecordId={searchParams.recordId} initialSection={searchParams.section}/>;
}
