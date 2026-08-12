import { notFound } from 'next/navigation';
import WeeklyProcessOverview from '@/components/weekly-processes/WeeklyProcessOverview';
import { dailyPlanEnabled } from '@/lib/daily-plan-feature';
import { requirePageAccess } from '@/lib/page-access';
import './weekly-process-overview.css';

export const dynamic = 'force-dynamic';

export default async function WeeklyProcessesPage() {
  if (!dailyPlanEnabled()) notFound();
  const user = await requirePageAccess('/workspace/weekly-processes');
  if (!user.canAccessWeeklyProcesses) notFound();
  return <WeeklyProcessOverview user={user} />;
}
