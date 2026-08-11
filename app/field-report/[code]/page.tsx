import FieldReportMobile from '@/components/FieldReportMobile';
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
  return <FieldReportMobile code={params.code} user={user} />;
}
