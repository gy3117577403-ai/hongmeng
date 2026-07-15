import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import WeeklyPlanCenterShell from '@/components/WeeklyPlanCenterShell';
import './weekly-plan-workbench.css';

export default async function WeeklyPlanCenterPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  return <WeeklyPlanCenterShell user={user} />;
}
