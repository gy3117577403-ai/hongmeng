import FieldReportMobile from '@/components/FieldReportMobile';
import QualityScanTabs from '@/components/quality-data/QualityScanTabs';
import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/page-access';
import './field-report.css';

export const dynamic = 'force-dynamic';

export default async function FieldReportPage({
  params,
}: {
  params: { code: string };
}) {
  const next = `/field-report/${encodeURIComponent(params.code)}`;
  const user = await requirePageAccess(next);
  const quality = user.access.capabilities.includes('QUALITY_DATA:READ');
  if (quality && !user.access.capabilities.includes('FIELD_REPORT:READ')) redirect('/quality-capture/' + encodeURIComponent(params.code));
  return <>{quality && <QualityScanTabs code={params.code} active="report"/>}<FieldReportMobile code={params.code} user={user} /></>;
}
