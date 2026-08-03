import { notFound, redirect } from 'next/navigation';
import WeeklyProcessOverview from '@/components/weekly-processes/WeeklyProcessOverview';
import { currentUser } from '@/lib/auth';
import { dailyPlanEnabled } from '@/lib/daily-plan-feature';
import './weekly-process-overview.css';

export const dynamic = 'force-dynamic';

export default async function WeeklyProcessesPage() {
  if (!dailyPlanEnabled()) notFound();
  const user = await currentUser();
  if (!user) redirect('/login?next=%2Fworkspace%2Fweekly-processes');
  if (!user.canAccessDailyPlans) notFound();
  return <WeeklyProcessOverview user={user} />;
}
