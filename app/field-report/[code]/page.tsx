import { redirect } from 'next/navigation';
import FieldReportMobile from '@/components/FieldReportMobile';
import { currentUser } from '@/lib/auth';
import './field-report.css';

export const dynamic = 'force-dynamic';

export default async function FieldReportPage({ params }: { params: { code: string } }) {
  const next = `/field-report/${encodeURIComponent(params.code)}`;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return <FieldReportMobile code={params.code} user={user} />;
}
