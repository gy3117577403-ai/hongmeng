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
  const canQuick = user.access.capabilities.includes('QUALITY:READ');
  const canReport = user.access.capabilities.includes('FIELD_REPORT:READ');
  if (!canReport && !quality && canQuick) redirect('/quality-quick-capture/' + encodeURIComponent(params.code));
  if (quality && !canQuick && !canReport) redirect('/quality-capture/' + encodeURIComponent(params.code));
  if ((quality || canQuick) && (searchParams.mode !== 'report' || !canReport)) return <QualityScanEntry code={params.code} name={user.displayName || user.username} canQuick={canQuick} canQuality={quality} canReport={canReport}/>;
  return quality ? <div className="qd-report-shell"><QualityScanTabs code={params.code} active="report" canQuick={user.access.capabilities.includes('QUALITY:READ')}/><FieldReportMobile code={params.code} user={user}/></div> : <FieldReportMobile code={params.code} user={user}/>;
}
