import { redirect } from 'next/navigation';
import TrainingScanMobile from '@/components/TrainingScanMobile';
import { currentUser } from '@/lib/auth';
import './training-scan.css';

export const dynamic = 'force-dynamic';

export default async function TrainingScanPage({ params }: { params: { code: string } }) {
  const next = `/training/scan/${encodeURIComponent(params.code)}`;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (user.mustChangePassword) redirect(`/change-password?next=${encodeURIComponent(next)}`);
  return <TrainingScanMobile code={params.code} user={{
    displayName: user.employee?.name || user.displayName,
    employeeNo: user.employee?.employeeNo || null,
  }} />;
}
