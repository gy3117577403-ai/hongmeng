import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import PlanningCenterShell from '@/components/PlanningCenterShell';
import './planning-center.css';

export default async function WeeklyPlanCenterPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  return <PlanningCenterShell user={user} />;
}
