import { notFound, redirect } from 'next/navigation';
import DailyPlanWorkbench from '@/components/daily-plans/DailyPlanWorkbench';
import { currentUser } from '@/lib/auth';
import { dailyPlanEnabled } from '@/lib/daily-plan-feature';
import './daily-plan-workbench.css';

export const dynamic = 'force-dynamic';

export default async function DailyPlansPage() {
  if (!dailyPlanEnabled()) notFound();

  const user = await currentUser();
  if (!user) redirect('/login?next=%2Fworkspace%2Fdaily-plans');
  if (!user.canAccessDailyPlans) notFound();

  return <DailyPlanWorkbench user={user} />;
}
