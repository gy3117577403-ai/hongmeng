import FieldReportMobile from '@/components/FieldReportMobile';
import QualityScanTabs from '@/components/quality-data/QualityScanTabs';
import QualityScanEntry from '@/components/quality-data/QualityScanEntry';
import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/page-access';
import './field-report.css';
import '@/components/quality-data/quality-scan.css';

export const dynamic = 'force-dynamic';

export default async function FieldReportPage({
  params,
  searchParams,
}: {
  params: { code: string };
  searchParams: { mode?: string };
}) {
  const next = `/field-report/${encodeURIComponent(params.code)}`;
  const user = await requirePageAccess(next, next + (searchParams.mode === 'report' ? '?mode=report' : ''));
  const quality = user.access.capabilities.includes('QUALITY_DATA:READ');
  if (quality && !user.access.capabilities.includes('FIELD_REPORT:READ')) redirect('/quality-capture/' + encodeURIComponent(params.code));
  if (quality && searchParams.mode !== 'report') return <QualityScanEntry code={params.code} name={user.displayName || user.username}/>;
  return quality ? <div className="qd-report-shell"><QualityScanTabs code={params.code} active="report"/><FieldReportMobile code={params.code} user={user}/></div> : <FieldReportMobile code={params.code} user={user}/>;
}
