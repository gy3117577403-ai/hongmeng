import PlanningCenterShell from '@/components/PlanningCenterShell';
import { requirePageAccess } from '@/lib/page-access';
import './planning-center.css';

export default async function WeeklyPlanCenterPage() {
  const user = await requirePageAccess('/weekly-plan-center');
  return <PlanningCenterShell user={user} />;
}
